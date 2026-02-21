# Contributing to openclaw-sms-gateway

## Prerequisites

- Node.js 22+
- npm

## Setup

```bash
git clone https://github.com/AidanZealworthy/openclaw-sms-gateway.git
cd openclaw-sms-gateway
npm install --ignore-scripts
```

The `--ignore-scripts` flag is needed because the `openclaw` dev dependency includes native modules that don't need to be built for plugin development.

## Development Commands

### Run Tests

```bash
npm test
```

Tests use [Vitest](https://vitest.dev/). To run in watch mode:

```bash
npm run test:watch
```

### Lint

```bash
npm run lint
```

To auto-fix lint issues:

```bash
npm run lint:fix
```

Linting uses [oxlint](https://oxc.rs/docs/guide/usage/linter) with `--type-aware` checks enabled, matching OpenClaw's style.

### Format

```bash
npm run format
```

To check formatting without writing:

```bash
npm run format:check
```

Formatting uses [oxfmt](https://oxc.rs/docs/guide/usage/formatter), matching OpenClaw's style.

### Type Check

```bash
npm run typecheck
```

Runs `tsc --noEmit` to verify TypeScript types without emitting output.

## Project Structure

```
index.ts                          # Plugin entry point
src/
  config.ts                       # Parse + validate plugin config
  api/
    client.ts                     # sms-gate.app REST client
  tools/
    sms-send.ts                   # sms_send tool
    sms-get-messages.ts           # sms_get_messages tool
    sms-get-status.ts             # sms_get_status tool
  webhook/
    handler.ts                    # HTTP route handler for incoming webhooks
    signature.ts                  # HMAC-SHA256 verification
  store/
    message-store.ts              # File-backed message store
  service/
    lifecycle.ts                  # Background service: register webhooks on startup
```

Test files are co-located with their source files (e.g. `src/config.test.ts`).

## Testing Notes

- Tests mock `openclaw/plugin-sdk` imports since the plugin runs inside the OpenClaw gateway process at runtime but tests run standalone.
- The `SmsGatewayClient` tests mock `globalThis.fetch` to avoid real network calls.
- The `MessageStore` tests use a temporary directory for file persistence.
