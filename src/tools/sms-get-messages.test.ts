import { describe, it, expect, vi, afterEach } from "vitest";
import { createSmsGetMessagesTool } from "./sms-get-messages.js";
import type { MessageStore, InboxMessage, SentMessage } from "../store/message-store.js";

function makeStore(inbox: InboxMessage[] = [], sent: SentMessage[] = []): MessageStore {
  return {
    queryInbox: vi.fn().mockReturnValue(inbox),
    querySent: vi.fn().mockReturnValue(sent),
    addInboxMessage: vi.fn(),
    addSentMessage: vi.fn(),
    getSentMessage: vi.fn(),
    updateSentStatus: vi.fn(),
    init: vi.fn(),
    flush: vi.fn(),
  } as unknown as MessageStore;
}

const now = Date.now();

function makeInbox(overrides: Partial<InboxMessage> & { id: string }): InboxMessage {
  return {
    from: "+15551111111",
    text: "Hello",
    receivedAt: now,
    simNumber: 1,
    ...overrides,
  };
}

function makeSent(overrides: Partial<SentMessage> & { id: string }): SentMessage {
  return {
    to: "+15552222222",
    text: "Hi back",
    sentAt: now,
    status: "delivered",
    updatedAt: now,
    errorReason: null,
    ...overrides,
  };
}

describe("sms_get_messages tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns both inbound and outbound messages by default", async () => {
    const inbox = [makeInbox({ id: "in1", receivedAt: now - 10_000 })];
    const sent = [makeSent({ id: "out1", sentAt: now - 5_000 })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, sent));
    const result = await tool.execute("call-1", {});

    const { messages, count } = result.details as any;
    expect(count).toBe(2);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ direction: "outbound", id: "out1" });
    expect(messages[1]).toMatchObject({ direction: "inbound", id: "in1" });
  });

  it("filters to inbound only", async () => {
    const inbox = [makeInbox({ id: "in1", receivedAt: now - 10_000 })];
    const sent = [makeSent({ id: "out1", sentAt: now - 5_000 })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, sent));
    const result = await tool.execute("call-2", { direction: "inbound" });

    const { messages, count } = result.details as any;
    expect(count).toBe(1);
    expect(messages[0]).toMatchObject({
      direction: "inbound",
      id: "in1",
      from: "+15551111111",
      text: "Hello",
    });
  });

  it("filters to outbound only", async () => {
    const inbox = [makeInbox({ id: "in1", receivedAt: now - 10_000 })];
    const sent = [makeSent({ id: "out1", sentAt: now - 5_000 })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, sent));
    const result = await tool.execute("call-3", { direction: "outbound" });

    const { messages, count } = result.details as any;
    expect(count).toBe(1);
    expect(messages[0]).toMatchObject({
      direction: "outbound",
      id: "out1",
      to: "+15552222222",
      text: "Hi back",
    });
  });

  it("passes phone_number filter and returns matching messages", async () => {
    // Mock returns what the real store would after filtering by phone number
    const matchingInbox = [makeInbox({ id: "in1", from: "+15551111111" })];
    const matchingSent = [makeSent({ id: "out1", to: "+15551111111" })];
    const tool = createSmsGetMessagesTool(makeStore(matchingInbox, matchingSent));
    const result = await tool.execute("call-4", { phone_number: "+15551111111" });

    const { messages, count } = result.details as any;
    expect(count).toBe(2);
    expect(messages[0]).toMatchObject({ id: "in1", from: "+15551111111" });
    expect(messages[1]).toMatchObject({ id: "out1", to: "+15551111111" });
  });

  it("uses default since_minutes_ago of 60", async () => {
    // Mock returns only recent messages (simulating store filtering to last 60 min)
    const recentInbox = [makeInbox({ id: "recent", receivedAt: now - 30 * 60_000 })];
    const tool = createSmsGetMessagesTool(makeStore(recentInbox, []));
    const result = await tool.execute("call-5", {});

    const { messages, count } = result.details as any;
    expect(count).toBe(1);
    expect(messages[0]).toMatchObject({ id: "recent", direction: "inbound" });
  });

  it("uses custom since_minutes_ago", async () => {
    // Mock returns only messages within 30 min (simulating store filtering)
    const recentInbox = [makeInbox({ id: "within-30", receivedAt: now - 15 * 60_000 })];
    const tool = createSmsGetMessagesTool(makeStore(recentInbox, []));
    const result = await tool.execute("call-6", { since_minutes_ago: 30 });

    const { messages, count } = result.details as any;
    expect(count).toBe(1);
    expect(messages[0]).toMatchObject({ id: "within-30" });
  });

  it("caps results at default limit of 20", async () => {
    const inbox = Array.from({ length: 25 }, (_, i) =>
      makeInbox({ id: `m${i}`, receivedAt: now - i * 1000 }),
    );
    const tool = createSmsGetMessagesTool(makeStore(inbox, []));
    const result = await tool.execute("call-7", {});

    const { messages, count, limit } = result.details as any;
    expect(limit).toBe(20);
    expect(messages).toHaveLength(20);
    expect(count).toBe(20);
    // Should be the 20 newest (m0 through m19)
    expect(messages[0].id).toBe("m0");
    expect(messages[19].id).toBe("m19");
  });

  it("sorts merged messages newest first", async () => {
    const inbox = [makeInbox({ id: "older-inbound", receivedAt: now - 30_000 })];
    const sent = [makeSent({ id: "newer-outbound", sentAt: now - 1_000 })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, sent));
    const result = await tool.execute("call-8", {});

    const { messages } = result.details as any;
    expect(messages[0]).toMatchObject({ id: "newer-outbound", direction: "outbound" });
    expect(messages[1]).toMatchObject({ id: "older-inbound", direction: "inbound" });
  });

  it("applies offset and limit to merged results", async () => {
    // 5 messages: m4 (newest) through m0 (oldest)
    const inbox = Array.from({ length: 5 }, (_, i) =>
      makeInbox({ id: `m${i}`, receivedAt: now - (5 - i) * 1000 }),
    );
    const tool = createSmsGetMessagesTool(makeStore(inbox, []));
    const result = await tool.execute("call-9", { limit: 2, offset: 1 });

    const { messages, count, offset, limit } = result.details as any;
    expect(offset).toBe(1);
    expect(limit).toBe(2);
    expect(messages).toHaveLength(2);
    // Sorted newest first: m4, m3, m2, m1, m0. Offset 1, limit 2 → m3, m2
    expect(messages[0].id).toBe("m3");
    expect(messages[1].id).toBe("m2");
  });

  it("enforces minimum limit of 1", async () => {
    const inbox = [makeInbox({ id: "m0" })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, []));
    const result = await tool.execute("call-10", { limit: -5 });

    const { messages, limit } = result.details as any;
    expect(limit).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("m0");
  });

  it("enforces minimum offset of 0", async () => {
    const inbox = [makeInbox({ id: "m0" }), makeInbox({ id: "m1", receivedAt: now - 1000 })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, []));
    const result = await tool.execute("call-11", { offset: -3 });

    const { messages, offset } = result.details as any;
    expect(offset).toBe(0);
    expect(messages).toHaveLength(2);
  });

  it("returns content as parseable JSON matching details", async () => {
    const inbox = [makeInbox({ id: "in1", from: "+15551111111", text: "Hey" })];
    const tool = createSmsGetMessagesTool(makeStore(inbox, []));
    const result = await tool.execute("call-12", {});

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(result.details);
  });

  it("returns empty results when store has no messages", async () => {
    const tool = createSmsGetMessagesTool(makeStore([], []));
    const result = await tool.execute("call-13", {});

    const { messages, count } = result.details as any;
    expect(messages).toEqual([]);
    expect(count).toBe(0);
  });

  it("maps inbound message fields correctly", async () => {
    const inbox = [
      makeInbox({
        id: "in1",
        from: "+15559999999",
        text: "Mapped",
        receivedAt: 1000,
        simNumber: 2,
      }),
    ];
    const tool = createSmsGetMessagesTool(makeStore(inbox, []));
    const result = await tool.execute("call-14", {});

    const msg = (result.details as any).messages[0];
    expect(msg).toEqual({
      direction: "inbound",
      id: "in1",
      from: "+15559999999",
      text: "Mapped",
      receivedAt: 1000,
      simNumber: 2,
    });
  });

  it("maps outbound message fields correctly", async () => {
    const sent = [
      makeSent({
        id: "out1",
        to: "+15558888888",
        text: "Sent!",
        sentAt: 2000,
        status: "failed",
        errorReason: "timeout",
      }),
    ];
    const tool = createSmsGetMessagesTool(makeStore([], sent));
    const result = await tool.execute("call-15", {});

    const msg = (result.details as any).messages[0];
    expect(msg).toEqual({
      direction: "outbound",
      id: "out1",
      to: "+15558888888",
      text: "Sent!",
      sentAt: 2000,
      status: "failed",
      errorReason: "timeout",
    });
  });
});
