import crypto from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  readRequestBodyWithLimit: vi.fn(),
  isRequestBodyLimitError: vi.fn().mockReturnValue(false),
  createDedupeCache: vi.fn(() => ({
    check: vi.fn().mockReturnValue(false),
  })),
}));

import {
  readRequestBodyWithLimit,
  isRequestBodyLimitError,
  createDedupeCache,
} from "openclaw/plugin-sdk";
import { createWebhookHandler } from "./handler.js";
import type { SmsGatewayConfig } from "../config.js";
import type { MessageStore } from "../store/message-store.js";
import type { PluginRuntime, OpenClawConfig } from "openclaw/plugin-sdk";

function makeConfig(overrides?: Partial<SmsGatewayConfig>): SmsGatewayConfig {
  return {
    username: "testuser",
    password: "testpass",
    publicUrl: "https://example.com",
    webhookSecret: "test-secret",
    apiUrl: "https://api.sms-gate.app/3rdparty/v1",
    defaultSimNumber: 1,
    webhookPath: "/plugins/sms-gateway/webhook",
    retentionMinutes: null,
    retentionMaxMessages: null,
    ...overrides,
  };
}

function makeStore(): MessageStore {
  return {
    init: vi.fn(),
    flush: vi.fn(),
    addInboxMessage: vi.fn(),
    queryInbox: vi.fn(),
    querySent: vi.fn(),
    addSentMessage: vi.fn(),
    getSentMessage: vi.fn(),
    updateSentStatus: vi.fn(),
  } as unknown as MessageStore;
}

function makeRuntime(): PluginRuntime {
  return {
    channel: {
      routing: {
        resolveAgentRoute: vi.fn().mockReturnValue({ sessionKey: "test-session" }),
      },
    },
    system: {
      enqueueSystemEvent: vi.fn(),
    },
  } as unknown as PluginRuntime;
}

function makeOpenClawConfig(overrides?: Partial<OpenClawConfig>): OpenClawConfig {
  return {
    hooks: { enabled: false },
    gateway: { port: 18789 },
    ...overrides,
  } as unknown as OpenClawConfig;
}

function sign(secret: string, body: string): { signature: string; timestamp: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(body + timestamp)
    .digest("hex");
  return { signature, timestamp };
}

function makeReq(method: string, headers?: Record<string, string>): IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as IncomingMessage;
  req.method = method;
  req.headers = {};
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      req.headers[k.toLowerCase()] = v;
    }
  }
  return req;
}

function makeRes(): ServerResponse & {
  _statusCode: number;
  _body: string;
  _headers: Record<string, string>;
} {
  const res = {
    _statusCode: 200,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(code: number, headers?: Record<string, string>) {
      res._statusCode = code;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    end(body?: string) {
      if (body) res._body = body;
    },
  } as unknown as ServerResponse & {
    _statusCode: number;
    _body: string;
    _headers: Record<string, string>;
  };
  return res;
}

describe("createWebhookHandler", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(readRequestBodyWithLimit).mockReset();
    vi.mocked(isRequestBodyLimitError).mockReset().mockReturnValue(false);
    vi.mocked(createDedupeCache).mockReturnValue({
      check: vi.fn().mockReturnValue(false),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-POST requests with 405", async () => {
    const handler = createWebhookHandler(
      makeConfig(),
      makeStore(),
      makeRuntime(),
      makeOpenClawConfig(),
    );
    const req = makeReq("GET");
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(405);
    expect(JSON.parse(res._body)).toEqual({ error: "Method not allowed" });
  });

  it("returns 401 on invalid signature", async () => {
    const body = JSON.stringify({ id: "evt1", event: "sms:received", payload: {} });
    vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

    const handler = createWebhookHandler(
      makeConfig(),
      makeStore(),
      makeRuntime(),
      makeOpenClawConfig(),
    );
    const req = makeReq("POST", { "x-signature": "bad", "x-timestamp": "123" });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(401);
    expect(JSON.parse(res._body).error).toBeDefined();
  });

  it("returns 400 on invalid JSON", async () => {
    const body = "not json";
    const { signature, timestamp } = sign("test-secret", body);
    vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

    const handler = createWebhookHandler(
      makeConfig(),
      makeStore(),
      makeRuntime(),
      makeOpenClawConfig(),
    );
    const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(JSON.parse(res._body)).toEqual({ error: "Invalid JSON" });
  });

  it("returns 200 for duplicate event", async () => {
    vi.mocked(createDedupeCache).mockReturnValue({
      check: vi.fn().mockReturnValue(true), // already seen
    } as any);

    const body = JSON.stringify({ id: "evt1", event: "sms:received", payload: {} });
    const { signature, timestamp } = sign("test-secret", body);
    vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

    const handler = createWebhookHandler(
      makeConfig(),
      makeStore(),
      makeRuntime(),
      makeOpenClawConfig(),
    );
    const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ ok: true });
  });

  describe("sms:received", () => {
    it("stores inbox message and returns 200", async () => {
      const store = makeStore();
      const payload = {
        phoneNumber: "+15551234567",
        message: "Hello",
        receivedAt: new Date().toISOString(),
        simNumber: 1,
      };
      const body = JSON.stringify({ id: "evt1", event: "sms:received", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(
        makeConfig(),
        store,
        makeRuntime(),
        makeOpenClawConfig(),
      );
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(res._statusCode).toBe(200);
      expect(JSON.parse(res._body)).toEqual({ ok: true });
      expect(store.addInboxMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "+15551234567",
          text: "Hello",
          simNumber: 1,
        }),
      );
    });

    it("calls /hooks/wake when hooks are enabled", async () => {
      const store = makeStore();
      const openclawConfig = makeOpenClawConfig({
        hooks: { enabled: true, token: "hook-token" },
        gateway: { port: 18789 },
      } as any);

      const payload = { phoneNumber: "+15551234567", message: "Test msg" };
      const body = JSON.stringify({ id: "evt2", event: "sms:received", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(makeConfig(), store, makeRuntime(), openclawConfig);
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:18789/hooks/wake",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer hook-token",
          }),
        }),
      );
    });

    it("falls back to enqueueSystemEvent when hooks are disabled", async () => {
      const store = makeStore();
      const runtime = makeRuntime();
      const openclawConfig = makeOpenClawConfig({ hooks: { enabled: false } } as any);

      const payload = { phoneNumber: "+15551234567", message: "Fallback msg" };
      const body = JSON.stringify({ id: "evt3", event: "sms:received", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(makeConfig(), store, runtime, openclawConfig);
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(runtime.system.enqueueSystemEvent).toHaveBeenCalledWith(
        expect.stringContaining("SMS received from +15551234567"),
        expect.objectContaining({ sessionKey: "test-session" }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not store message with missing phoneNumber", async () => {
      const store = makeStore();
      const payload = { message: "No phone" };
      const body = JSON.stringify({ id: "evt4", event: "sms:received", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(
        makeConfig(),
        store,
        makeRuntime(),
        makeOpenClawConfig(),
      );
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(store.addInboxMessage).not.toHaveBeenCalled();
    });
  });

  describe("sms:sent", () => {
    it("updates sent status to 'sent'", async () => {
      const store = makeStore();
      const payload = { messageId: "msg1" };
      const body = JSON.stringify({ id: "evt5", event: "sms:sent", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(
        makeConfig(),
        store,
        makeRuntime(),
        makeOpenClawConfig(),
      );
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(store.updateSentStatus).toHaveBeenCalledWith("msg1", "sent");
    });
  });

  describe("sms:delivered", () => {
    it("updates sent status to 'delivered'", async () => {
      const store = makeStore();
      const payload = { messageId: "msg2" };
      const body = JSON.stringify({ id: "evt6", event: "sms:delivered", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(
        makeConfig(),
        store,
        makeRuntime(),
        makeOpenClawConfig(),
      );
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(store.updateSentStatus).toHaveBeenCalledWith("msg2", "delivered");
    });
  });

  describe("sms:failed", () => {
    it("updates sent status to 'failed' with error reason", async () => {
      const store = makeStore();
      const payload = { messageId: "msg3", error: "phone unreachable" };
      const body = JSON.stringify({ id: "evt7", event: "sms:failed", payload });
      const { signature, timestamp } = sign("test-secret", body);
      vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

      const handler = createWebhookHandler(
        makeConfig(),
        store,
        makeRuntime(),
        makeOpenClawConfig(),
      );
      const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
      const res = makeRes();
      await handler(req, res);

      expect(store.updateSentStatus).toHaveBeenCalledWith("msg3", "failed", "phone unreachable");
    });
  });

  it("returns 200 for unknown event types", async () => {
    const body = JSON.stringify({ id: "evt8", event: "sms:unknown", payload: {} });
    const { signature, timestamp } = sign("test-secret", body);
    vi.mocked(readRequestBodyWithLimit).mockResolvedValue(body);

    const handler = createWebhookHandler(
      makeConfig(),
      makeStore(),
      makeRuntime(),
      makeOpenClawConfig(),
    );
    const req = makeReq("POST", { "x-signature": signature, "x-timestamp": timestamp });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ ok: true });
  });
});
