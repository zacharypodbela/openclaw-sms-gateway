import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk";
import { SmsGatewayClient } from "./src/api/client.js";
import { parseConfig } from "./src/config.js";
import { createLifecycleService } from "./src/service/lifecycle.js";
import { MessageStore } from "./src/store/message-store.js";
import { createSmsGetMessagesTool } from "./src/tools/sms-get-messages.js";
import { createSmsGetStatusTool } from "./src/tools/sms-get-status.js";
import { createSmsSendTool } from "./src/tools/sms-send.js";
import { createWebhookHandler } from "./src/webhook/handler.js";

export default function register(api: OpenClawPluginApi) {
  const config = parseConfig(api.pluginConfig);
  const client = new SmsGatewayClient(config);
  const store = new MessageStore();

  // Tools -- gated for sandbox
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return [
        createSmsSendTool(client, config, store),
        createSmsGetMessagesTool(store),
        createSmsGetStatusTool(client, store),
      ] as AnyAgentTool[];
    }) as OpenClawPluginToolFactory,
    {
      names: ["sms_send", "sms_get_messages", "sms_get_status"],
    },
  );

  // Webhook route
  api.registerHttpRoute({
    path: config.webhookPath,
    handler: createWebhookHandler(config, store),
  });

  // Background service
  api.registerService(createLifecycleService(config, client, store));
}
