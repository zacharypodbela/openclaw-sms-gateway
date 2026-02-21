import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLifecycleService } from "./lifecycle.js";
import type { SmsGatewayConfig } from "../config.js";
import type { SmsGatewayClient } from "../api/client.js";
import type { MessageStore } from "../store/message-store.js";
import type { OpenClawPluginServiceContext } from "openclaw/plugin-sdk";

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

function makeClient(overrides?: Partial<SmsGatewayClient>): SmsGatewayClient {
  return {
    listWebhooks: vi.fn().mockResolvedValue([]),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
    registerWebhook: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    getMessageState: vi.fn(),
  } as unknown as SmsGatewayClient;
}

function makeStore(): MessageStore {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    addInboxMessage: vi.fn(),
    queryInbox: vi.fn(),
    querySent: vi.fn(),
    addSentMessage: vi.fn(),
    getSentMessage: vi.fn(),
    updateSentStatus: vi.fn(),
  } as unknown as MessageStore;
}

function makeCtx(overrides?: Partial<OpenClawPluginServiceContext>): OpenClawPluginServiceContext {
  return {
    stateDir: "/tmp/test-state",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  } as unknown as OpenClawPluginServiceContext;
}

describe("createLifecycleService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a service with id 'sms-gateway'", () => {
    const service = createLifecycleService(makeConfig(), makeClient(), makeStore());
    expect(service.id).toBe("sms-gateway");
  });

  describe("start", () => {
    it("initializes the message store", async () => {
      const store = makeStore();
      const service = createLifecycleService(makeConfig(), makeClient(), store);
      await service.start(makeCtx());
      expect(store.init).toHaveBeenCalledWith("/tmp/test-state", null, null);
    });

    it("deletes existing plugin webhooks before registering", async () => {
      const client = makeClient();
      vi.mocked(client.listWebhooks).mockResolvedValue([
        { id: "openclaw-sms-gateway-sms-received", url: "https://old.com", event: "sms:received" },
        { id: "some-other-webhook", url: "https://other.com", event: "other" },
      ]);
      const service = createLifecycleService(makeConfig(), client, makeStore());
      await service.start(makeCtx());

      expect(client.deleteWebhook).toHaveBeenCalledWith("openclaw-sms-gateway-sms-received");
      expect(client.deleteWebhook).not.toHaveBeenCalledWith("some-other-webhook");
    });

    it("registers 4 webhooks", async () => {
      const client = makeClient();
      const config = makeConfig({
        publicUrl: "https://example.com",
        webhookPath: "/plugins/sms-gateway/webhook",
      });
      const service = createLifecycleService(config, client, makeStore());
      await service.start(makeCtx());

      expect(client.registerWebhook).toHaveBeenCalledTimes(4);
      expect(client.registerWebhook).toHaveBeenCalledWith(
        "openclaw-sms-gateway-sms-received",
        "https://example.com/plugins/sms-gateway/webhook",
        "sms:received",
      );
      expect(client.registerWebhook).toHaveBeenCalledWith(
        "openclaw-sms-gateway-sms-sent",
        "https://example.com/plugins/sms-gateway/webhook",
        "sms:sent",
      );
      expect(client.registerWebhook).toHaveBeenCalledWith(
        "openclaw-sms-gateway-sms-delivered",
        "https://example.com/plugins/sms-gateway/webhook",
        "sms:delivered",
      );
      expect(client.registerWebhook).toHaveBeenCalledWith(
        "openclaw-sms-gateway-sms-failed",
        "https://example.com/plugins/sms-gateway/webhook",
        "sms:failed",
      );
    });

    it("logs warning when listWebhooks fails", async () => {
      const client = makeClient();
      vi.mocked(client.listWebhooks).mockRejectedValue(new Error("network error"));
      const ctx = makeCtx();
      const service = createLifecycleService(makeConfig(), client, makeStore());
      await service.start(ctx);

      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("failed to list webhooks"),
      );
    });

    it("logs error when registerWebhook fails", async () => {
      const client = makeClient();
      vi.mocked(client.registerWebhook).mockRejectedValue(new Error("forbidden"));
      const ctx = makeCtx();
      const service = createLifecycleService(makeConfig(), client, makeStore());
      await service.start(ctx);

      expect(ctx.logger.error).toHaveBeenCalled();
    });

    it("starts periodic flush timer", async () => {
      const store = makeStore();
      const service = createLifecycleService(makeConfig(), makeClient(), store);
      await service.start(makeCtx());

      expect(store.flush).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store.flush).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(store.flush).toHaveBeenCalledTimes(2);
    });
  });

  describe("stop", () => {
    it("clears flush timer and flushes store", async () => {
      const store = makeStore();
      const service = createLifecycleService(makeConfig(), makeClient(), store);
      const ctx = makeCtx();
      await service.start(ctx);

      vi.mocked(store.flush).mockClear();
      await service.stop!(ctx);

      // Advancing timer should not trigger another flush
      await vi.advanceTimersByTimeAsync(30_000);
      // One call from stop(), zero from timer
      expect(store.flush).toHaveBeenCalledTimes(1);
    });
  });
});
