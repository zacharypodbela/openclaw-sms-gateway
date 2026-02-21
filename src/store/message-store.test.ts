import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  withFileLock: async (_filePath: string, _opts: unknown, fn: () => Promise<void>) => fn(),
}));

import { MessageStore } from "./message-store.js";
import type { InboxMessage, SentMessage } from "./message-store.js";

describe("MessageStore", () => {
  let tmpDir: string;
  let store: MessageStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sms-store-test-"));
    store = new MessageStore();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeInbox(overrides?: Partial<InboxMessage>): InboxMessage {
    return {
      id: "inbox-1",
      from: "+15551111111",
      text: "Hello",
      receivedAt: Date.now(),
      simNumber: 1,
      ...overrides,
    };
  }

  function makeSent(overrides?: Partial<SentMessage>): SentMessage {
    return {
      id: "sent-1",
      to: "+15552222222",
      text: "Hi there",
      sentAt: Date.now(),
      status: "pending",
      updatedAt: Date.now(),
      errorReason: null,
      ...overrides,
    };
  }

  describe("init", () => {
    it("creates the state directory and starts with empty store", async () => {
      await store.init(tmpDir, null, null);
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toEqual([]);
    });

    it("loads existing store from disk", async () => {
      const storeDir = path.join(tmpDir, "sms-gateway");
      await fs.mkdir(storeDir, { recursive: true });
      await fs.writeFile(
        path.join(storeDir, "store.json"),
        JSON.stringify({
          version: 1,
          inbox: [makeInbox({ id: "persisted-1" })],
          sent: [],
        }),
      );

      await store.init(tmpDir, null, null);
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("persisted-1");
    });

    it("starts fresh on corrupt store file", async () => {
      const storeDir = path.join(tmpDir, "sms-gateway");
      await fs.mkdir(storeDir, { recursive: true });
      await fs.writeFile(path.join(storeDir, "store.json"), "not json");

      await store.init(tmpDir, null, null);
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toEqual([]);
    });

    it("starts fresh on missing store file", async () => {
      await store.init(tmpDir, null, null);
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toEqual([]);
    });
  });

  describe("inbox operations", () => {
    beforeEach(async () => {
      await store.init(tmpDir, null, null);
    });

    it("adds and queries inbox messages", () => {
      store.addInboxMessage(makeInbox({ id: "m1" }));
      store.addInboxMessage(makeInbox({ id: "m2" }));
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toHaveLength(2);
    });

    it("returns newest first", () => {
      store.addInboxMessage(makeInbox({ id: "m1", receivedAt: 1000 }));
      store.addInboxMessage(makeInbox({ id: "m2", receivedAt: 2000 }));
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results[0].id).toBe("m2");
      expect(results[1].id).toBe("m1");
    });

    it("filters by sender", () => {
      store.addInboxMessage(makeInbox({ id: "m1", from: "+15551111111" }));
      store.addInboxMessage(makeInbox({ id: "m2", from: "+15552222222" }));
      const results = store.queryInbox({ from: "+15551111111", limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m1");
    });

    it("filters by time window", () => {
      const now = Date.now();
      store.addInboxMessage(makeInbox({ id: "m1", receivedAt: now - 120_000 })); // 2min ago
      store.addInboxMessage(makeInbox({ id: "m2", receivedAt: now }));
      const results = store.queryInbox({ sinceMs: 60_000, limit: 100, offset: 0 }); // last 1min
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("m2");
    });

    it("supports pagination with offset and limit", () => {
      store.addInboxMessage(makeInbox({ id: "m1", receivedAt: 1000 }));
      store.addInboxMessage(makeInbox({ id: "m2", receivedAt: 2000 }));
      store.addInboxMessage(makeInbox({ id: "m3", receivedAt: 3000 }));

      const page1 = store.queryInbox({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);
      expect(page1[0].id).toBe("m3");

      const page2 = store.queryInbox({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
      expect(page2[0].id).toBe("m1");
    });
  });

  describe("sent operations", () => {
    beforeEach(async () => {
      await store.init(tmpDir, null, null);
    });

    it("adds and queries sent messages", () => {
      store.addSentMessage(makeSent({ id: "s1" }));
      const results = store.querySent({ limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
    });

    it("filters sent by recipient", () => {
      store.addSentMessage(makeSent({ id: "s1", to: "+15551111111" }));
      store.addSentMessage(makeSent({ id: "s2", to: "+15552222222" }));
      const results = store.querySent({ to: "+15551111111", limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("s1");
    });

    it("looks up sent message by ID", () => {
      store.addSentMessage(makeSent({ id: "s1" }));
      const result = store.getSentMessage("s1");
      expect(result?.id).toBe("s1");
    });

    it("returns undefined for unknown sent message ID", () => {
      const result = store.getSentMessage("nonexistent");
      expect(result).toBeUndefined();
    });

    it("updates sent message status", () => {
      store.addSentMessage(makeSent({ id: "s1", status: "pending" }));
      const updated = store.updateSentStatus("s1", "delivered");
      expect(updated).toBe(true);
      const msg = store.getSentMessage("s1");
      expect(msg?.status).toBe("delivered");
    });

    it("updates sent message with error reason", () => {
      store.addSentMessage(makeSent({ id: "s1", status: "pending" }));
      store.updateSentStatus("s1", "failed", "phone unreachable");
      const msg = store.getSentMessage("s1");
      expect(msg?.status).toBe("failed");
      expect(msg?.errorReason).toBe("phone unreachable");
    });

    it("returns false when updating nonexistent message", () => {
      const updated = store.updateSentStatus("nonexistent", "delivered");
      expect(updated).toBe(false);
    });
  });

  describe("retention pruning", () => {
    it("prunes inbox by retention time", async () => {
      await store.init(tmpDir, 1, null); // 1 minute retention
      const now = Date.now();
      store.addInboxMessage(makeInbox({ id: "old", receivedAt: now - 120_000 })); // 2min ago
      store.addInboxMessage(makeInbox({ id: "new", receivedAt: now }));
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("new");
    });

    it("prunes sent by retention time", async () => {
      await store.init(tmpDir, 1, null); // 1 minute retention
      const now = Date.now();
      store.addSentMessage(makeSent({ id: "old", sentAt: now - 120_000 }));
      store.addSentMessage(makeSent({ id: "new", sentAt: now }));
      const results = store.querySent({ limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("new");
    });

    it("caps store at maxSize (removes oldest)", async () => {
      await store.init(tmpDir, null, 2); // max 2 messages
      store.addInboxMessage(makeInbox({ id: "m1", receivedAt: 1000 }));
      store.addInboxMessage(makeInbox({ id: "m2", receivedAt: 2000 }));
      store.addInboxMessage(makeInbox({ id: "m3", receivedAt: 3000 }));
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toHaveLength(2);
      expect(results.map((m) => m.id)).toEqual(["m3", "m2"]);
    });

    it("does not prune when retention is null", async () => {
      await store.init(tmpDir, null, null);
      const old = Date.now() - 7 * 24 * 60 * 60 * 1000; // 1 week ago
      store.addInboxMessage(makeInbox({ id: "old", receivedAt: old }));
      const results = store.queryInbox({ limit: 100, offset: 0 });
      expect(results).toHaveLength(1);
    });
  });

  describe("persistence", () => {
    it("flushes to disk and reloads", async () => {
      await store.init(tmpDir, null, null);
      store.addInboxMessage(makeInbox({ id: "m1" }));
      store.addSentMessage(makeSent({ id: "s1" }));
      await store.flush();

      const store2 = new MessageStore();
      await store2.init(tmpDir, null, null);
      expect(store2.queryInbox({ limit: 100, offset: 0 })).toHaveLength(1);
      expect(store2.querySent({ limit: 100, offset: 0 })).toHaveLength(1);
    });

    it("flush is a no-op before init", async () => {
      const uninitStore = new MessageStore();
      await expect(uninitStore.flush()).resolves.toBeUndefined();
    });
  });
});
