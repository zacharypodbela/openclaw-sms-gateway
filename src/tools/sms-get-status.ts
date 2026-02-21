import { Type } from "@sinclair/typebox";
import type { SmsGatewayClient } from "../api/client.js";
import type { MessageStore } from "../store/message-store.js";

export function createSmsGetStatusTool(client: SmsGatewayClient, store: MessageStore) {
  return {
    name: "sms_get_status",
    label: "Get SMS Status",
    description: "Get the delivery status of a previously sent SMS message by its message ID.",
    parameters: Type.Object({
      message_id: Type.String({
        description: "The message ID returned by sms_send",
      }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const messageId = typeof params.message_id === "string" ? params.message_id.trim() : "";
      if (!messageId) {
        throw new Error("Missing required parameter: message_id");
      }

      // Check local store first (webhook may have already updated status)
      const local = store.getSentMessage(messageId);
      if (local && local.status !== "pending") {
        const result = {
          messageId: local.id,
          to: local.to,
          status: local.status,
          errorReason: local.errorReason,
          updatedAt: local.updatedAt,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      // Fall back to API
      try {
        const apiState = await client.getMessageState(messageId);
        const status = apiState.state ?? "unknown";

        // Update local store if we got a definitive status
        if (status === "sent" || status === "delivered" || status === "failed") {
          const errorReason = apiState.recipients?.[0]?.error ?? null;
          store.updateSentStatus(
            messageId,
            status as "sent" | "delivered" | "failed",
            errorReason ?? undefined,
          );
        }

        const result = {
          messageId,
          status,
          recipients: apiState.recipients,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (err) {
        // If we have a local record, return what we know
        if (local) {
          const result = {
            messageId: local.id,
            to: local.to,
            status: local.status,
            errorReason: local.errorReason,
            updatedAt: local.updatedAt,
            note: "API lookup failed, showing cached status",
          };
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        }
        throw new Error(
          `Failed to get message status: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
