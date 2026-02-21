import { Type } from "@sinclair/typebox";
import type { InboxMessage, SentMessage, MessageStore } from "../store/message-store.js";

type UnifiedMessage =
  | {
      direction: "inbound";
      id: string;
      from: string;
      text: string;
      receivedAt: number;
      simNumber: number;
    }
  | {
      direction: "outbound";
      id: string;
      to: string;
      text: string;
      sentAt: number;
      status: string;
      errorReason: string | null;
    };

export function createSmsGetMessagesTool(store: MessageStore) {
  return {
    name: "sms_get_messages",
    label: "Get SMS Messages",
    description:
      "Retrieve SMS messages — both received (inbound) and sent (outbound). Filter by phone number to see a conversation with a specific person.",
    parameters: Type.Object({
      phone_number: Type.Optional(
        Type.String({
          description:
            "Filter by phone number in E.164 format (e.g. +15551234567). Matches sender on inbound and recipient on outbound.",
        }),
      ),
      direction: Type.Optional(
        Type.Unsafe<"inbound" | "outbound" | "all">({
          type: "string",
          enum: ["inbound", "outbound", "all"],
          description: "Filter by message direction (default: all)",
        }),
      ),
      since_minutes_ago: Type.Optional(
        Type.Number({
          description: "Only return messages within this many minutes (default: 60)",
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
      const phoneNumber =
        typeof params.phone_number === "string" && params.phone_number.trim()
          ? params.phone_number.trim()
          : undefined;
      const direction = typeof params.direction === "string" ? params.direction : "all";
      const sinceMinutes =
        typeof params.since_minutes_ago === "number" ? params.since_minutes_ago : 60;
      const limit = typeof params.limit === "number" ? Math.max(1, params.limit) : 20;
      const offset = typeof params.offset === "number" ? Math.max(0, params.offset) : 0;

      const sinceMs = sinceMinutes * 60 * 1000;
      const messages: UnifiedMessage[] = [];

      if (direction === "all" || direction === "inbound") {
        const inbound = store.queryInbox({
          from: phoneNumber,
          sinceMs,
          limit: limit + offset, // fetch enough to merge
          offset: 0,
        });
        for (const m of inbound) {
          messages.push({
            direction: "inbound",
            id: m.id,
            from: m.from,
            text: m.text,
            receivedAt: m.receivedAt,
            simNumber: m.simNumber,
          });
        }
      }

      if (direction === "all" || direction === "outbound") {
        const outbound = store.querySent({
          to: phoneNumber,
          sinceMs,
          limit: limit + offset,
          offset: 0,
        });
        for (const m of outbound) {
          messages.push({
            direction: "outbound",
            id: m.id,
            to: m.to,
            text: m.text,
            sentAt: m.sentAt,
            status: m.status,
            errorReason: m.errorReason,
          });
        }
      }

      // Sort newest first by timestamp
      messages.sort((a, b) => {
        const tsA = a.direction === "inbound" ? a.receivedAt : a.sentAt;
        const tsB = b.direction === "inbound" ? b.receivedAt : b.sentAt;
        return tsB - tsA;
      });

      // Apply offset/limit to merged results
      const paged = messages.slice(offset, offset + limit);

      const result = {
        messages: paged,
        count: paged.length,
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
