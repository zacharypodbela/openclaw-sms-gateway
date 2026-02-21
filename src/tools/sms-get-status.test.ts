import { describe, it, expect, vi, afterEach } from "vitest";
import { createSmsGetStatusTool } from "./sms-get-status.js";
import type { SmsGatewayClient } from "../api/client.js";
import type { MessageStore, SentMessage } from "../store/message-store.js";

function makeClient(overrides?: Partial<SmsGatewayClient>): SmsGatewayClient {
  return {
    sendMessage: vi.fn(),
    getMessageState: vi.fn().mockResolvedValue({ id: "msg1", state: "delivered" }),
    registerWebhook: vi.fn(),
    listWebhooks: vi.fn(),
    deleteWebhook: vi.fn(),
    ...overrides,
  } as unknown as SmsGatewayClient;
}

function makeStore(sentMessage?: SentMessage): MessageStore {
  return {
    getSentMessage: vi.fn().mockReturnValue(sentMessage),
    updateSentStatus: vi.fn(),
    addInboxMessage: vi.fn(),
    addSentMessage: vi.fn(),
    queryInbox: vi.fn(),
    querySent: vi.fn(),
    init: vi.fn(),
    flush: vi.fn(),
  } as unknown as MessageStore;
}

const now = Date.now();

const deliveredMsg: SentMessage = {
  id: "msg1",
  to: "+15551234567",
  text: "Hello",
  sentAt: now,
  status: "delivered",
  updatedAt: now + 1000,
  errorReason: null,
};

const pendingMsg: SentMessage = {
  id: "msg2",
  to: "+15551234567",
  text: "Hello",
  sentAt: now,
  status: "pending",
  updatedAt: now,
  errorReason: null,
};

const failedMsg: SentMessage = {
  id: "msg3",
  to: "+15551234567",
  text: "Hello",
  sentAt: now,
  status: "failed",
  updatedAt: now + 500,
  errorReason: "phone unreachable",
};

describe("sms_get_status tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns delivered status from local store", async () => {
    const tool = createSmsGetStatusTool(makeClient(), makeStore(deliveredMsg));
    const result = await tool.execute("call-1", { message_id: "msg1" });

    const details = result.details as any;
    expect(details.messageId).toBe("msg1");
    expect(details.to).toBe("+15551234567");
    expect(details.status).toBe("delivered");
    expect(details.errorReason).toBeNull();
    expect(details.updatedAt).toBe(now + 1000);
  });

  it("returns failed status with error reason from local store", async () => {
    const tool = createSmsGetStatusTool(makeClient(), makeStore(failedMsg));
    const result = await tool.execute("call-2", { message_id: "msg3" });

    const details = result.details as any;
    expect(details.messageId).toBe("msg3");
    expect(details.status).toBe("failed");
    expect(details.errorReason).toBe("phone unreachable");
  });

  it("falls back to API when local status is pending", async () => {
    const client = makeClient({
      getMessageState: vi.fn().mockResolvedValue({
        id: "msg2",
        state: "sent",
        recipients: [{ phoneNumber: "+15551234567", state: "sent" }],
      }),
    } as any);
    const tool = createSmsGetStatusTool(client, makeStore(pendingMsg));
    const result = await tool.execute("call-3", { message_id: "msg2" });

    const details = result.details as any;
    expect(details.messageId).toBe("msg2");
    expect(details.status).toBe("sent");
    expect(details.recipients).toEqual([{ phoneNumber: "+15551234567", state: "sent" }]);
  });

  it("falls back to API when message not in store", async () => {
    const client = makeClient({
      getMessageState: vi.fn().mockResolvedValue({
        id: "msg-unknown",
        state: "delivered",
        recipients: [{ phoneNumber: "+15551234567", state: "delivered" }],
      }),
    } as any);
    const tool = createSmsGetStatusTool(client, makeStore(undefined));
    const result = await tool.execute("call-4", { message_id: "msg-unknown" });

    const details = result.details as any;
    expect(details.messageId).toBe("msg-unknown");
    expect(details.status).toBe("delivered");
    expect(details.recipients).toHaveLength(1);
  });

  it("returns API status with recipients for pending local message", async () => {
    const client = makeClient({
      getMessageState: vi.fn().mockResolvedValue({
        id: "msg2",
        state: "delivered",
        recipients: [{ phoneNumber: "+15551234567", state: "delivered" }],
      }),
    } as any);
    const tool = createSmsGetStatusTool(client, makeStore(pendingMsg));
    const result = await tool.execute("call-5", { message_id: "msg2" });

    const details = result.details as any;
    expect(details.status).toBe("delivered");
    expect(details.recipients[0].phoneNumber).toBe("+15551234567");
  });

  it("returns cached status with note when API fails and local record exists", async () => {
    const client = makeClient({
      getMessageState: vi.fn().mockRejectedValue(new Error("network error")),
    } as any);
    const tool = createSmsGetStatusTool(client, makeStore(pendingMsg));
    const result = await tool.execute("call-6", { message_id: "msg2" });

    const details = result.details as any;
    expect(details.messageId).toBe("msg2");
    expect(details.to).toBe("+15551234567");
    expect(details.status).toBe("pending");
    expect(details.note).toContain("API lookup failed");
  });

  it("throws when API fails and no local record", async () => {
    const client = makeClient({
      getMessageState: vi.fn().mockRejectedValue(new Error("network error")),
    } as any);
    const tool = createSmsGetStatusTool(client, makeStore(undefined));

    await expect(tool.execute("call-7", { message_id: "unknown" })).rejects.toThrow(
      "Failed to get message status",
    );
  });

  it("throws on missing message_id", async () => {
    const tool = createSmsGetStatusTool(makeClient(), makeStore());
    await expect(tool.execute("call-8", {})).rejects.toThrow(
      "Missing required parameter: message_id",
    );
  });

  it("throws on empty message_id", async () => {
    const tool = createSmsGetStatusTool(makeClient(), makeStore());
    await expect(tool.execute("call-9", { message_id: "   " })).rejects.toThrow(
      "Missing required parameter: message_id",
    );
  });

  it("returns content as JSON that matches details", async () => {
    const tool = createSmsGetStatusTool(makeClient(), makeStore(deliveredMsg));
    const result = await tool.execute("call-10", { message_id: "msg1" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(result.details);
  });
});
