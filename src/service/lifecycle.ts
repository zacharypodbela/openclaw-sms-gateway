import type {
  OpenClawPluginService,
  OpenClawPluginServiceContext,
  PluginLogger,
} from "openclaw/plugin-sdk";
import type { SmsGatewayClient } from "../api/client.js";
import type { SmsGatewayConfig } from "../config.js";
import type { MessageStore } from "../store/message-store.js";

const FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const WEBHOOK_ID_PREFIX = "openclaw-sms-gateway-";

const WEBHOOK_EVENTS = [
  { id: `${WEBHOOK_ID_PREFIX}sms-received`, event: "sms:received" },
  { id: `${WEBHOOK_ID_PREFIX}sms-sent`, event: "sms:sent" },
  { id: `${WEBHOOK_ID_PREFIX}sms-delivered`, event: "sms:delivered" },
  { id: `${WEBHOOK_ID_PREFIX}sms-failed`, event: "sms:failed" },
] as const;

export function createLifecycleService(
  config: SmsGatewayConfig,
  client: SmsGatewayClient,
  store: MessageStore,
): OpenClawPluginService {
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  return {
    id: "sms-gateway",

    async start(ctx: OpenClawPluginServiceContext) {
      const { logger } = ctx;

      // Initialize message store
      await store.init(ctx.stateDir, config.inboxRetentionMinutes, config.maxStoreSize);
      logger.info("sms-gateway: message store initialized");

      // Start periodic flush
      flushTimer = setInterval(() => {
        store.flush().catch((err) => {
          logger.error(
            `sms-gateway: flush error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, FLUSH_INTERVAL_MS);

      // Register webhooks
      await registerWebhooks(config, client, logger);
    },

    async stop(_ctx: OpenClawPluginServiceContext) {
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      await store.flush();
    },
  };
}

async function registerWebhooks(
  config: SmsGatewayConfig,
  client: SmsGatewayClient,
  logger: PluginLogger,
): Promise<void> {
  const webhookUrl = config.publicUrl + config.webhookPath;

  // Delete existing plugin webhooks
  try {
    const existing = await client.listWebhooks();
    for (const hook of existing) {
      if (hook.id.startsWith(WEBHOOK_ID_PREFIX)) {
        try {
          await client.deleteWebhook(hook.id);
        } catch (err) {
          logger.warn(
            `sms-gateway: failed to delete webhook ${hook.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  } catch (err) {
    logger.warn(
      `sms-gateway: failed to list webhooks: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Register fresh webhooks
  let registered = 0;
  for (const { id, event } of WEBHOOK_EVENTS) {
    try {
      await client.registerWebhook(id, webhookUrl, event);
      registered++;
    } catch (err) {
      logger.error(
        `sms-gateway: failed to register webhook ${id} (${event}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger.info(
    `sms-gateway: registered ${registered}/${WEBHOOK_EVENTS.length} webhooks at ${webhookUrl}`,
  );
}
