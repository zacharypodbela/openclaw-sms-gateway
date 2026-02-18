import { Type } from "@sinclair/typebox";
import type { MessageStore } from "../store/message-store.js";

export function createSmsCheckInboxTool(store: MessageStore) {
  return {
    name: "sms_check_inbox",
    label: "Check SMS Inbox",
    description:
      "Check the SMS inbox for received text messages. Returns messages newest-first.",
    parameters: Type.Object({
      from: Type.Optional(
        Type.String({
          description:
            "Filter by sender phone number in E.164 format (e.g. +15551234567)",
        }),
      ),
      since_minutes_ago: Type.Optional(
        Type.Number({
          description:
            "Only return messages received within this many minutes (default: 60)",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of messages to return (default: 20)",
        }),
      ),
      offset: Type.Optional(
        Type.Number({
          description: "Number of messages to skip for pagination (default: 0)",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const from =
        typeof params.from === "string" && params.from.trim()
          ? params.from.trim()
          : undefined;
      const sinceMinutes =
        typeof params.since_minutes_ago === "number"
          ? params.since_minutes_ago
          : 60;
      const limit =
        typeof params.limit === "number" ? Math.max(1, params.limit) : 20;
      const offset =
        typeof params.offset === "number" ? Math.max(0, params.offset) : 0;

      const messages = store.queryInbox({
        from,
        sinceMs: sinceMinutes * 60 * 1000,
        limit,
        offset,
      });

      const result = {
        messages,
        count: messages.length,
        offset,
        limit,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
