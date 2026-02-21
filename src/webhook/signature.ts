import crypto from "node:crypto";

const DEFAULT_MAX_SKEW_SECONDS = 300; // 5 minutes

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  maxSkewSeconds: number = DEFAULT_MAX_SKEW_SECONDS,
): VerifyResult {
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: "missing X-Signature or X-Timestamp header" };
  }

  // Validate timestamp
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "invalid X-Timestamp value" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const skew = Math.abs(nowSeconds - timestamp);
  if (skew > maxSkewSeconds) {
    return { ok: false, reason: "timestamp outside acceptable window" };
  }

  // Compute expected signature: HMAC-SHA256(secret, body + timestamp)
  const message = body + timestampHeader;
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");

  // Timing-safe comparison
  if (expected.length !== signatureHeader.length) {
    return { ok: false, reason: "invalid signature" };
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(signatureHeader, "utf8"),
  );

  if (!isValid) {
    return { ok: false, reason: "invalid signature" };
  }

  return { ok: true };
}
