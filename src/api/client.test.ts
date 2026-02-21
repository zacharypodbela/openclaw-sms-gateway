import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SmsGatewayClient } from "./client.js";
import type { SmsGatewayConfig } from "../config.js";

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

describe("SmsGatewayClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Basic Auth header on all requests", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "msg1", state: "pending", recipients: [] }), {
        status: 200,
      }),
    );
    const client = new SmsGatewayClient(makeConfig());
    await client.sendMessage(["+15551234567"], "Hello");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(headers.Authorization.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("testuser:testpass");
  });

  describe("sendMessage", () => {
    it("sends POST to /messages with correct payload", async () => {
      const responseBody = {
        id: "msg1",
        state: "pending",
        recipients: [{ phoneNumber: "+15551234567", state: "pending" }],
      };
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));

      const client = new SmsGatewayClient(makeConfig());
      const result = await client.sendMessage(["+15551234567"], "Hello", 1);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.sms-gate.app/3rdparty/v1/messages");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.textMessage.text).toBe("Hello");
      expect(body.phoneNumbers).toEqual(["+15551234567"]);
      expect(body.simNumber).toBe(1);
      expect(result).toEqual(responseBody);
    });

    it("omits simNumber when not provided", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ id: "msg1", state: "pending", recipients: [] }), {
          status: 200,
        }),
      );
      const client = new SmsGatewayClient(makeConfig());
      await client.sendMessage(["+15551234567"], "Hello");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.simNumber).toBeUndefined();
    });
  });

  describe("getMessageState", () => {
    it("sends GET to /messages/{id}", async () => {
      const responseBody = { id: "msg1", state: "delivered" };
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));

      const client = new SmsGatewayClient(makeConfig());
      const result = await client.getMessageState("msg1");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.sms-gate.app/3rdparty/v1/messages/msg1");
      expect(init?.method).toBe("GET");
      expect(result).toEqual(responseBody);
    });

    it("encodes message ID in URL", async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ id: "a/b", state: "pending" }), { status: 200 }),
      );
      const client = new SmsGatewayClient(makeConfig());
      await client.getMessageState("a/b");

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("/messages/a%2Fb");
    });
  });

  describe("registerWebhook", () => {
    it("sends POST to /webhooks", async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
      const client = new SmsGatewayClient(makeConfig());
      await client.registerWebhook("hook1", "https://example.com/webhook", "sms:received");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.sms-gate.app/3rdparty/v1/webhooks");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({
        id: "hook1",
        url: "https://example.com/webhook",
        event: "sms:received",
      });
    });
  });

  describe("listWebhooks", () => {
    it("sends GET to /webhooks", async () => {
      const hooks = [{ id: "hook1", url: "https://example.com", event: "sms:received" }];
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(hooks), { status: 200 }));

      const client = new SmsGatewayClient(makeConfig());
      const result = await client.listWebhooks();

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.sms-gate.app/3rdparty/v1/webhooks");
      expect(init?.method).toBe("GET");
      expect(result).toEqual(hooks);
    });
  });

  describe("deleteWebhook", () => {
    it("sends DELETE to /webhooks/{id}", async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
      const client = new SmsGatewayClient(makeConfig());
      await client.deleteWebhook("hook1");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.sms-gate.app/3rdparty/v1/webhooks/hook1");
      expect(init?.method).toBe("DELETE");
    });
  });

  describe("error handling", () => {
    it("throws on non-2xx response with status detail", async () => {
      fetchSpy.mockResolvedValue(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      );
      const client = new SmsGatewayClient(makeConfig());
      await expect(client.listWebhooks()).rejects.toThrow(
        "sms-gateway API error: 404 Not Found: Not Found",
      );
    });

    it("throws on network error without leaking credentials", async () => {
      fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
      const client = new SmsGatewayClient(makeConfig());
      await expect(client.listWebhooks()).rejects.toThrow(
        "sms-gateway API request failed: ECONNREFUSED",
      );
    });

    it("truncates long error response bodies", async () => {
      const longBody = "x".repeat(1000);
      fetchSpy.mockResolvedValue(
        new Response(longBody, { status: 500, statusText: "Server Error" }),
      );
      const client = new SmsGatewayClient(makeConfig());
      const err = await client.listWebhooks().catch((e) => e);
      expect(err.message.length).toBeLessThan(600);
    });
  });
});
