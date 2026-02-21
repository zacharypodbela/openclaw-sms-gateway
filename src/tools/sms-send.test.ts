import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  normalizeE164: vi.fn((input: string) => {
    if (!/^\+\d{7,15}$/.test(input)) {
      throw new Error(`Invalid E.164 phone number: ${input}`);
    }
    return input;
  }),
}));

import { createSmsSendTool } from "./sms-send.js";
import type { SmsGatewayClient } from "../api/client.js";
import type { SmsGatewayConfig } from "../config.js";
import type { MessageStore } from "../store/message-store.js";

function makeClient(response?: { id: string; state: string }): SmsGatewayClient {
  return {
    sendMessage: vi.fn().mockResolvedValue(
      response ?? {
        id: "msg-123",
        state: "pending",
        recipients: [{ phoneNumber: "+15551234567", state: "pending" }],
      },
    ),
    getMessageState: vi.fn(),
    registerWebhook: vi.fn(),
    listWebhooks: vi.fn(),
    deleteWebhook: vi.fn(),
  } as unknown as SmsGatewayClient;
}

function makeConfig(overrides?: Partial<SmsGatewayConfig>): SmsGatewayConfig {
  return {
    username: "testuser",
    password: "testpass",
    publicUrl: "https://example.com",
    webhookSecret: "secret",
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
    addSentMessage: vi.fn(),
    getSentMessage: vi.fn(),
    updateSentStatus: vi.fn(),
    addInboxMessage: vi.fn(),
    queryInbox: vi.fn(),
    querySent: vi.fn(),
    init: vi.fn(),
    flush: vi.fn(),
  } as unknown as MessageStore;
}

describe("sms_send tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a message and returns messageId, to, and pending status", async () => {
    const tool = createSmsSendTool(makeClient(), makeConfig(), makeStore());
    const result = await tool.execute("call-1", { to: "+15551234567", text: "Hello" });

    const details = result.details as { messageId: string; to: string; status: string };
    expect(details.messageId).toBe("msg-123");
    expect(details.to).toBe("+15551234567");
    expect(details.status).toBe("pending");
  });

  it("returns a different messageId from a different API response", async () => {
    const client = makeClient({ id: "msg-456", state: "pending" });
    const tool = createSmsSendTool(client, makeConfig(), makeStore());
    const result = await tool.execute("call-2", { to: "+15559999999", text: "Hi" });

    const details = result.details as { messageId: string; to: string };
    expect(details.messageId).toBe("msg-456");
    expect(details.to).toBe("+15559999999");
  });

  it("returns content as JSON that matches details", async () => {
    const tool = createSmsSendTool(makeClient(), makeConfig(), makeStore());
    const result = await tool.execute("call-3", { to: "+15551234567", text: "Hey" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(result.details);
  });

  it("throws on missing 'to' parameter", async () => {
    const tool = createSmsSendTool(makeClient(), makeConfig(), makeStore());
    await expect(tool.execute("call-4", { text: "Hi" })).rejects.toThrow(
      "Missing required parameter: to",
    );
  });

  it("throws on missing 'text' parameter", async () => {
    const tool = createSmsSendTool(makeClient(), makeConfig(), makeStore());
    await expect(tool.execute("call-5", { to: "+15551234567" })).rejects.toThrow(
      "Missing required parameter: text",
    );
  });

  it("throws on invalid E.164 phone number", async () => {
    const tool = createSmsSendTool(makeClient(), makeConfig(), makeStore());
    await expect(tool.execute("call-6", { to: "not-a-phone", text: "Hi" })).rejects.toThrow(
      "Invalid E.164",
    );
  });

  it("trims whitespace from 'to' and normalizes it in the result", async () => {
    const tool = createSmsSendTool(makeClient(), makeConfig(), makeStore());
    const result = await tool.execute("call-7", { to: " +15551234567 ", text: "Hi" });

    const details = result.details as { to: string };
    expect(details.to).toBe("+15551234567");
  });
});
