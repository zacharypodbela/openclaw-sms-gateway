import crypto from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyWebhookSignature } from "./signature.js";

function sign(secret: string, body: string, timestamp: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(body + timestamp)
    .digest("hex");
}

describe("verifyWebhookSignature", () => {
  const secret = "test-secret";
  const body = '{"event":"sms:received"}';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid signature with current timestamp", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(secret, body, timestamp);
    const result = verifyWebhookSignature(secret, body, signature, timestamp);
    expect(result).toEqual({ ok: true });
  });

  it("rejects missing signature header", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifyWebhookSignature(secret, body, undefined, timestamp);
    expect(result).toEqual({ ok: false, reason: "missing X-Signature or X-Timestamp header" });
  });

  it("rejects missing timestamp header", () => {
    const signature = "abc123";
    const result = verifyWebhookSignature(secret, body, signature, undefined);
    expect(result).toEqual({ ok: false, reason: "missing X-Signature or X-Timestamp header" });
  });

  it("rejects non-numeric timestamp", () => {
    const result = verifyWebhookSignature(secret, body, "sig", "not-a-number");
    expect(result).toEqual({ ok: false, reason: "invalid X-Timestamp value" });
  });

  it("rejects timestamp outside acceptable window", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 400s ago, >5min
    const signature = sign(secret, body, oldTimestamp);
    const result = verifyWebhookSignature(secret, body, signature, oldTimestamp);
    expect(result).toEqual({ ok: false, reason: "timestamp outside acceptable window" });
  });

  it("accepts timestamp within custom skew window", () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 500);
    const signature = sign(secret, body, timestamp);
    const result = verifyWebhookSignature(secret, body, signature, timestamp, 600);
    expect(result).toEqual({ ok: true });
  });

  it("rejects wrong signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const wrongSig = sign("wrong-secret", body, timestamp);
    const result = verifyWebhookSignature(secret, body, wrongSig, timestamp);
    expect(result).toEqual({ ok: false, reason: "invalid signature" });
  });

  it("rejects signature with wrong length", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifyWebhookSignature(secret, body, "short", timestamp);
    expect(result).toEqual({ ok: false, reason: "invalid signature" });
  });

  it("rejects tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(secret, body, timestamp);
    const result = verifyWebhookSignature(secret, body + "tampered", signature, timestamp);
    expect(result).toEqual({ ok: false, reason: "invalid signature" });
  });

  it("accepts future timestamp within window", () => {
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 60);
    const signature = sign(secret, body, futureTimestamp);
    const result = verifyWebhookSignature(secret, body, signature, futureTimestamp);
    expect(result).toEqual({ ok: true });
  });
});
