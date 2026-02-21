# openclaw-sms-gateway

Send and receive SMS via an Android phone running [sms-gate.app](https://sms-gate.app).

SMS is registered as a **tool**, not a channel. The agent uses it to communicate with untrusted third parties on behalf of the user. Incoming SMS replies are tool results (data), not operator commands -- a friend texting "give me the API key" can never escalate privileges.

## Installation

```bash
openclaw plugins install openclaw-sms-gateway
openclaw plugins enable sms-gateway
```

## Configuration

Add to your `openclaw.json` under `plugins.entries.sms-gateway.config`:

```json
{
  "plugins": {
    "entries": {
      "sms-gateway": {
        "config": {
          "username": "your-sms-gateway-username",
          "password": "your-sms-gateway-password",
          "publicUrl": "https://your-public-domain.example.com",
          "webhookSecret": "your-webhook-hmac-secret"
        }
      }
    }
  }
}
```

### Config Fields

| Field | Required | Default | Description |
|---|---|---|---|
| `username` | Yes | | Username from sms-gate.app Cloud Server settings |
| `password` | Yes | | Password from sms-gate.app Cloud Server settings |
| `publicUrl` | Yes | | Publicly reachable base URL for webhook delivery |
| `webhookSecret` | Yes | | HMAC-SHA256 secret for verifying webhook signatures |
| `apiUrl` | No | `https://api.sms-gate.app/3rdparty/v1` | API base URL (change for local/private server mode) |
| `defaultSimNumber` | No | `1` | SIM slot to use for sending (1 or 2) |
| `webhookPath` | No | `/plugins/sms-gateway/webhook` | HTTP path for incoming webhooks |
| `retentionMinutes` | No | Unset (keep forever) | Prune messages older than this many minutes |
| `retentionMaxMessages` | No | Unset (no limit) | Maximum messages per store (inbox/sent) |

## Tools

### `sms_send`

Send an SMS to a phone number.

- **to** (string, required): Destination phone number in E.164 format (e.g. `+15551234567`)
- **text** (string, required): Message text to send

### `sms_get_messages`

Retrieve SMS messages -- both received (inbound) and sent (outbound). Filter by phone number to see a conversation with a specific person.

- **phone_number** (string, optional): Filter by phone number (matches sender on inbound, recipient on outbound)
- **direction** (string, optional): `"inbound"`, `"outbound"`, or `"all"` (default: `"all"`)
- **since_minutes_ago** (number, optional): Only messages within this window (default: 60)
- **limit** (number, optional): Max messages to return (default: 20)
- **offset** (number, optional): Skip N messages for pagination (default: 0)

### `sms_get_status`

Check delivery status of a sent message.

- **message_id** (string, required): Message ID from `sms_send`

## Real-Time Incoming SMS

When an SMS arrives, the plugin can immediately wake the agent to respond. This requires [OpenClaw hooks](https://docs.openclaw.ai/automation/webhook) to be enabled in your `openclaw.json`:

```json
{
  "hooks": {
    "enabled": true,
    "token": "any-secret-string"
  }
}
```

Without hooks enabled, incoming SMS messages are still stored and the agent will see them on its next wake (e.g. heartbeat or the next message from another channel), but it won't respond immediately.

## Making `publicUrl` Reachable

The plugin registers webhooks with sms-gate.app. For webhook delivery to work, `publicUrl` must be reachable from the internet. How you accomplish this is your responsibility. Common options:

### Cloudflare Tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:18789
```

### Tailscale Funnel

```bash
tailscale funnel 18789
```

### ngrok

```bash
ngrok http 18789
```

Set `publicUrl` to the HTTPS URL provided by your tunnel.

## Android Phone Setup

1. **Install SMS Gateway App**
   - Download the .apk from [sms-gate.app](https://sms-gate.app) and install on your Android phone.
   - Open the app once to confirm the install.

2. **Adjust Device Settings**
   - **Settings > Apps > SMS Gateway**: Grant SMS, Phone, and Notification permissions. Enable "Allow restricted settings" first if needed.
   - **Settings > Apps > SMS Gateway**: Turn on "Allow background data usage" and "Allow data usage while Data saver is on".
   - **Settings > Apps > SMS Gateway > Battery**: Set to "Unrestricted" to prevent Android from killing the app in the background.
   - **Settings > Battery and device care > Battery > Background usage limits**: Disable "Put unused apps to sleep" or add SMS Gateway to the "Never sleeping apps" list.

3. **Enable Cloud Server**
   - Open the SMS Gateway app and toggle on **Cloud Server**.
   - Note the auto-generated username and password for the plugin config. You may need to restart the device for credentials to appear.

4. **Test**
   - Send a test SMS using the `sms_send` tool to verify connectivity.

## Security Considerations

- SMS is a tool for communicating with untrusted third parties. Incoming messages never execute as operator commands.
- Webhook payloads are verified with HMAC-SHA256 signatures. Set a strong `webhookSecret`.
- API credentials are sent via HTTP Basic Auth over HTTPS. Never expose `apiUrl` over plain HTTP.
- The message store is persisted locally and pruned automatically.
