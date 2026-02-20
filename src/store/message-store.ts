import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock, type FileLockOptions } from "openclaw/plugin-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InboxMessage = {
  id: string;
  from: string;
  text: string;
  receivedAt: number;
  simNumber: number;
};

export type SentStatus = "pending" | "sent" | "delivered" | "failed";

export type SentMessage = {
  id: string;
  to: string;
  text: string;
  sentAt: number;
  status: SentStatus;
  updatedAt: number;
  errorReason: string | null;
};

type StoreData = {
  version: 1;
  inbox: InboxMessage[];
  sent: SentMessage[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_DIR = "sms-gateway";
const STORE_FILE = "store.json";

const LOCK_OPTIONS: FileLockOptions = {
  retries: { retries: 5, factor: 2, minTimeout: 50, maxTimeout: 2000 },
  stale: 30_000,
};

// ---------------------------------------------------------------------------
// MessageStore
// ---------------------------------------------------------------------------

export class MessageStore {
  private data: StoreData = { version: 1, inbox: [], sent: [] };
  private storePath: string | null = null;
  private retentionMs: number | null = null;
  private maxSize: number | null = null;

  /**
   * Initialize the store from disk. Must be called before use.
   */
  async init(
    stateDir: string,
    retentionMinutes: number | null,
    maxSize: number | null,
  ): Promise<void> {
    this.retentionMs = retentionMinutes != null ? retentionMinutes * 60 * 1000 : null;
    this.maxSize = maxSize;
    const dir = path.join(stateDir, STORE_DIR);
    await fs.mkdir(dir, { recursive: true });
    this.storePath = path.join(dir, STORE_FILE);
    await this.load();
  }

  // -----------------------------------------------------------------------
  // Inbox
  // -----------------------------------------------------------------------

  addInboxMessage(msg: InboxMessage): void {
    this.data.inbox.push(msg);
    this.prune();
  }

  queryInbox(opts: {
    from?: string;
    sinceMs?: number;
    limit: number;
    offset: number;
  }): InboxMessage[] {
    let results = this.data.inbox;

    if (opts.from) {
      const from = opts.from;
      results = results.filter((m) => m.from === from);
    }

    if (opts.sinceMs !== undefined) {
      const cutoff = Date.now() - opts.sinceMs;
      results = results.filter((m) => m.receivedAt >= cutoff);
    }

    // Newest first for the caller, then apply offset/limit
    const reversed = [...results].reverse();
    return reversed.slice(opts.offset, opts.offset + opts.limit);
  }

  querySent(opts: {
    to?: string;
    sinceMs?: number;
    limit: number;
    offset: number;
  }): SentMessage[] {
    let results = this.data.sent;

    if (opts.to) {
      const to = opts.to;
      results = results.filter((m) => m.to === to);
    }

    if (opts.sinceMs !== undefined) {
      const cutoff = Date.now() - opts.sinceMs;
      results = results.filter((m) => m.sentAt >= cutoff);
    }

    const reversed = [...results].reverse();
    return reversed.slice(opts.offset, opts.offset + opts.limit);
  }

  // -----------------------------------------------------------------------
  // Sent
  // -----------------------------------------------------------------------

  addSentMessage(msg: SentMessage): void {
    this.data.sent.push(msg);
    this.prune();
  }

  getSentMessage(id: string): SentMessage | undefined {
    return this.data.sent.find((m) => m.id === id);
  }

  updateSentStatus(
    messageId: string,
    status: SentStatus,
    errorReason?: string,
  ): boolean {
    const msg = this.data.sent.find((m) => m.id === messageId);
    if (!msg) {
      return false;
    }
    msg.status = status;
    msg.updatedAt = Date.now();
    if (errorReason !== undefined) {
      msg.errorReason = errorReason;
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  async flush(): Promise<void> {
    if (!this.storePath) {
      return;
    }
    const filePath = this.storePath;
    await withFileLock(filePath, LOCK_OPTIONS, async () => {
      await fs.writeFile(filePath, JSON.stringify(this.data, null, 2), "utf8");
    });
  }

  private async load(): Promise<void> {
    if (!this.storePath) {
      return;
    }
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed.version === 1 &&
        Array.isArray(parsed.inbox) &&
        Array.isArray(parsed.sent)
      ) {
        this.data = parsed as unknown as StoreData;
        this.prune();
      }
    } catch {
      // File doesn't exist or is corrupt -- start fresh
      this.data = { version: 1, inbox: [], sent: [] };
    }
  }

  private prune(): void {
    // Prune by retention
    if (this.retentionMs != null) {
      const cutoff = Date.now() - this.retentionMs;
      this.data.inbox = this.data.inbox.filter((m) => m.receivedAt >= cutoff);
      this.data.sent = this.data.sent.filter((m) => m.sentAt >= cutoff);
    }

    // Cap at maxSize (remove oldest from front)
    if (this.maxSize != null) {
      if (this.data.inbox.length > this.maxSize) {
        this.data.inbox = this.data.inbox.slice(
          this.data.inbox.length - this.maxSize,
        );
      }
      if (this.data.sent.length > this.maxSize) {
        this.data.sent = this.data.sent.slice(
          this.data.sent.length - this.maxSize,
        );
      }
    }
  }
}
