import type { IncomingMessage, ServerResponse } from "node:http";
import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  createDedupeCache,
} from "openclaw/plugin-sdk";
import type { SmsGatewayConfig } from "../config.js";
import type { MessageStore } from "../store/message-store.js";
import { verifyWebhookSignature } from "./signature.js";

const MAX_BODY_BYTES = 256 * 1024; // 256 KB
const DEDUPE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEDUPE_MAX_SIZE = 1000;

export function createWebhookHandler(
  config: SmsGatewayConfig,
  store: MessageStore,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const dedupe = createDedupeCache({
    ttlMs: DEDUPE_TTL_MS,
    maxSize: DEDUPE_MAX_SIZE,
  });

  return async (req, res) => {
    // Only accept POST
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Read raw body (needed for signature verification)
    let rawBody: string;
    try {
      rawBody = await readRequestBodyWithLimit(req, {
        maxBytes: MAX_BODY_BYTES,
      });
    } catch (err) {
      if (isRequestBodyLimitError(err)) {
        res.writeHead(err.statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read request body" }));
      return;
    }

    // Verify HMAC signature against raw body
    const sigResult = verifyWebhookSignature(
      config.webhookSecret,
      rawBody,
      getHeader(req, "x-signature"),
      getHeader(req, "x-timestamp"),
    );

    if (!sigResult.ok) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: sigResult.reason }));
      return;
    }

    // Parse JSON
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("expected JSON object");
      }
      data = parsed as Record<string, unknown>;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const eventId = typeof data.id === "string" ? data.id : undefined;
    const event = typeof data.event === "string" ? data.event : undefined;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    // Deduplicate by event ID
    if (dedupe.check(eventId)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Route by event type
    switch (event) {
      case "sms:received":
        handleSmsReceived(store, payload, data);
        break;
      case "sms:sent":
        handleSmsStatusUpdate(store, payload, "sent");
        break;
      case "sms:delivered":
        handleSmsStatusUpdate(store, payload, "delivered");
        break;
      case "sms:failed":
        handleSmsFailed(store, payload);
        break;
      // Unknown events are silently accepted
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleSmsReceived(
  store: MessageStore,
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
): void {
  const phoneNumber = typeof payload.phoneNumber === "string" ? payload.phoneNumber : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  const receivedAt = typeof payload.receivedAt === "string"
    ? new Date(payload.receivedAt).getTime()
    : Date.now();
  const simNumber = typeof payload.simNumber === "number" ? payload.simNumber : 0;
  const id = typeof data.id === "string" ? data.id : crypto.randomUUID();

  if (!phoneNumber || !message) {
    return;
  }

  store.addInboxMessage({
    id,
    from: phoneNumber,
    text: message,
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    simNumber,
  });
}

function handleSmsStatusUpdate(
  store: MessageStore,
  payload: Record<string, unknown>,
  status: "sent" | "delivered",
): void {
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  if (!messageId) {
    return;
  }
  store.updateSentStatus(messageId, status);
}

function handleSmsFailed(
  store: MessageStore,
  payload: Record<string, unknown>,
): void {
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const error = typeof payload.error === "string" ? payload.error : "unknown error";
  if (!messageId) {
    return;
  }
  store.updateSentStatus(messageId, "failed", error);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
