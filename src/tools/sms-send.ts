import { Type } from "@sinclair/typebox";
import { normalizeE164 } from "openclaw/plugin-sdk";
import type { SmsGatewayClient } from "../api/client.js";
import type { SmsGatewayConfig } from "../config.js";
import type { MessageStore } from "../store/message-store.js";

export function createSmsSendTool(
  client: SmsGatewayClient,
  config: SmsGatewayConfig,
  store: MessageStore,
) {
  return {
    name: "sms_send",
    label: "Send SMS",
    description: "Send an SMS text message to a phone number via the Android SMS gateway.",
    parameters: Type.Object({
      to: Type.String({
        description: "Destination phone number in E.164 format (e.g. +15551234567)",
      }),
      text: Type.String({
        description: "Message text to send",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const toRaw = typeof params.to === "string" ? params.to.trim() : "";
      const text = typeof params.text === "string" ? params.text : "";

      if (!toRaw) {
        throw new Error("Missing required parameter: to");
      }
      if (!text) {
        throw new Error("Missing required parameter: text");
      }

      const to = normalizeE164(toRaw);
      const response = await client.sendMessage([to], text, config.defaultSimNumber);

      const messageId = response.id ?? "";
      store.addSentMessage({
        id: messageId,
        to,
        text,
        sentAt: Date.now(),
        status: "pending",
        updatedAt: Date.now(),
        errorReason: null,
      });

      const result = {
        messageId,
        to,
        status: "pending",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
