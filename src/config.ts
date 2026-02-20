export type SmsGatewayConfig = {
  username: string;
  password: string;
  publicUrl: string;
  webhookSecret: string;
  apiUrl: string;
  defaultSimNumber: number;
  webhookPath: string;
  retentionMinutes: number | null;
  retentionMaxMessages: number | null;
};

export function parseConfig(
  pluginConfig: Record<string, unknown> | undefined,
): SmsGatewayConfig {
  const raw = pluginConfig ?? {};

  const username = expectString(raw, "username");
  const password = expectString(raw, "password");
  const publicUrl = expectString(raw, "publicUrl");
  const webhookSecret = expectString(raw, "webhookSecret");

  const apiUrl =
    optionalString(raw, "apiUrl") ?? "https://api.sms-gate.app/3rdparty/v1";
  const defaultSimNumber = optionalInt(raw, "defaultSimNumber") ?? 1;
  const webhookPath =
    optionalString(raw, "webhookPath") ?? "/plugins/sms-gateway/webhook";
  const retentionMinutes = optionalInt(raw, "retentionMinutes") ?? null;
  const retentionMaxMessages = optionalInt(raw, "retentionMaxMessages") ?? null;

  return {
    username,
    password,
    publicUrl: publicUrl.replace(/\/+$/, ""),
    webhookSecret,
    apiUrl: apiUrl.replace(/\/+$/, ""),
    defaultSimNumber,
    webhookPath,
    retentionMinutes,
    retentionMaxMessages,
  };
}

function expectString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `sms-gateway: missing required config field "${key}"`,
    );
  }
  return value.trim();
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(
      `sms-gateway: config field "${key}" must be a string`,
    );
  }
  return value.trim() || undefined;
}

function optionalInt(
  raw: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(
      `sms-gateway: config field "${key}" must be an integer`,
    );
  }
  return value;
}
