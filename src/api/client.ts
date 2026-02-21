import type { SmsGatewayConfig } from "../config.js";

export type SendMessageResponse = {
  id: string;
  state: string;
  recipients: Array<{ phoneNumber: string; state: string }>;
};

export type MessageStateResponse = {
  id: string;
  state: string;
  recipients?: Array<{ phoneNumber: string; state: string; error?: string }>;
};

export type WebhookEntry = {
  id: string;
  url: string;
  event: string;
  deviceId?: string;
};

export class SmsGatewayClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: SmsGatewayConfig) {
    this.baseUrl = config.apiUrl;
    this.authHeader =
      "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64");
  }

  async sendMessage(
    phoneNumbers: string[],
    text: string,
    simNumber?: number,
  ): Promise<SendMessageResponse> {
    const payload: Record<string, unknown> = {
      textMessage: { text },
      phoneNumbers,
    };
    if (simNumber !== undefined) {
      payload.simNumber = simNumber;
    }
    return await this.request<SendMessageResponse>("POST", "/messages", payload);
  }

  async getMessageState(id: string): Promise<MessageStateResponse> {
    return await this.request<MessageStateResponse>("GET", `/messages/${encodeURIComponent(id)}`);
  }

  async registerWebhook(id: string, url: string, event: string): Promise<unknown> {
    return await this.request("POST", "/webhooks", { id, url, event });
  }

  async listWebhooks(): Promise<WebhookEntry[]> {
    return await this.request<WebhookEntry[]>("GET", "/webhooks");
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request("DELETE", `/webhooks/${encodeURIComponent(id)}`);
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Never leak credentials in error messages
      const message = err instanceof Error ? err.message : "unknown network error";
      throw new Error(`sms-gateway API request failed: ${message}`);
    }

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const text = await res.text();
        if (text) {
          detail += `: ${text.slice(0, 500)}`;
        }
      } catch {
        // ignore body read failures
      }
      throw new Error(`sms-gateway API error: ${detail}`);
    }

    if (res.status === 204 || method === "DELETE") {
      return undefined as T;
    }

    return (await res.json()) as T;
  }
}
