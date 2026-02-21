import { describe, it, expect } from "vitest";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
  const validConfig = {
    username: "testuser",
    password: "testpass",
    publicUrl: "https://example.com",
    webhookSecret: "secret123",
  };

  it("parses valid config with all required fields", () => {
    const result = parseConfig(validConfig);
    expect(result.username).toBe("testuser");
    expect(result.password).toBe("testpass");
    expect(result.publicUrl).toBe("https://example.com");
    expect(result.webhookSecret).toBe("secret123");
  });

  it("applies defaults for optional fields", () => {
    const result = parseConfig(validConfig);
    expect(result.apiUrl).toBe("https://api.sms-gate.app/3rdparty/v1");
    expect(result.defaultSimNumber).toBe(1);
    expect(result.webhookPath).toBe("/plugins/sms-gateway/webhook");
    expect(result.retentionMinutes).toBeNull();
    expect(result.retentionMaxMessages).toBeNull();
  });

  it("uses provided optional values", () => {
    const result = parseConfig({
      ...validConfig,
      apiUrl: "https://custom.api.com/v1",
      defaultSimNumber: 2,
      webhookPath: "/custom/webhook",
      retentionMinutes: 120,
      retentionMaxMessages: 100,
    });
    expect(result.apiUrl).toBe("https://custom.api.com/v1");
    expect(result.defaultSimNumber).toBe(2);
    expect(result.webhookPath).toBe("/custom/webhook");
    expect(result.retentionMinutes).toBe(120);
    expect(result.retentionMaxMessages).toBe(100);
  });

  it("strips trailing slashes from publicUrl", () => {
    const result = parseConfig({ ...validConfig, publicUrl: "https://example.com///" });
    expect(result.publicUrl).toBe("https://example.com");
  });

  it("strips trailing slashes from apiUrl", () => {
    const result = parseConfig({ ...validConfig, apiUrl: "https://api.example.com/v1/" });
    expect(result.apiUrl).toBe("https://api.example.com/v1");
  });

  it("trims whitespace from string values", () => {
    const result = parseConfig({
      username: "  testuser  ",
      password: " testpass ",
      publicUrl: " https://example.com ",
      webhookSecret: " secret ",
    });
    expect(result.username).toBe("testuser");
    expect(result.password).toBe("testpass");
    expect(result.publicUrl).toBe("https://example.com");
    expect(result.webhookSecret).toBe("secret");
  });

  it("throws on missing username", () => {
    expect(() => parseConfig({ ...validConfig, username: undefined })).toThrow(
      'missing required config field "username"',
    );
  });

  it("throws on missing password", () => {
    expect(() => parseConfig({ ...validConfig, password: undefined })).toThrow(
      'missing required config field "password"',
    );
  });

  it("throws on missing publicUrl", () => {
    expect(() => parseConfig({ ...validConfig, publicUrl: undefined })).toThrow(
      'missing required config field "publicUrl"',
    );
  });

  it("throws on missing webhookSecret", () => {
    expect(() => parseConfig({ ...validConfig, webhookSecret: undefined })).toThrow(
      'missing required config field "webhookSecret"',
    );
  });

  it("throws on empty string for required field", () => {
    expect(() => parseConfig({ ...validConfig, username: "" })).toThrow(
      'missing required config field "username"',
    );
  });

  it("throws on whitespace-only string for required field", () => {
    expect(() => parseConfig({ ...validConfig, username: "   " })).toThrow(
      'missing required config field "username"',
    );
  });

  it("throws on non-string for required field", () => {
    expect(() => parseConfig({ ...validConfig, username: 123 })).toThrow(
      'missing required config field "username"',
    );
  });

  it("throws on non-string optional string field", () => {
    expect(() => parseConfig({ ...validConfig, apiUrl: 123 })).toThrow(
      'config field "apiUrl" must be a string',
    );
  });

  it("throws on non-integer optional int field", () => {
    expect(() => parseConfig({ ...validConfig, defaultSimNumber: 1.5 })).toThrow(
      'config field "defaultSimNumber" must be an integer',
    );
  });

  it("throws on non-number optional int field", () => {
    expect(() => parseConfig({ ...validConfig, retentionMinutes: "120" })).toThrow(
      'config field "retentionMinutes" must be an integer',
    );
  });

  it("handles undefined pluginConfig", () => {
    expect(() => parseConfig(undefined)).toThrow("missing required config field");
  });

  it("ignores empty optional string (returns default)", () => {
    const result = parseConfig({ ...validConfig, apiUrl: "" });
    expect(result.apiUrl).toBe("https://api.sms-gate.app/3rdparty/v1");
  });
});
