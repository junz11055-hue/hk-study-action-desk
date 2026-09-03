import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";

test("config generates a high-entropy local invite when none is supplied", () => {
  const config = loadConfig({ DEMO_INVITE_CODES: "" });
  assert.equal(config.inviteCodes.length, 1);
  assert.equal(config.inviteCodes[0], config.generatedInviteCode);
  assert.match(config.generatedInviteCode, /^HK-[A-Za-z0-9_-]{20,}$/);
});

test("config locks model credentials to the official DeepSeek HTTPS endpoint", () => {
  assert.equal(
    loadConfig({ DEMO_INVITE_CODES: "test", DEEPSEEK_BASE_URL: "https://api.deepseek.com" }).deepseek
      .baseUrl,
    "https://api.deepseek.com",
  );
  for (const unsafe of [
    "http://api.deepseek.com",
    "https://evil.invalid/v1",
    "https://api.deepseek.com.evil.invalid",
    "https://user:pass@api.deepseek.com",
    "https://api.deepseek.com/v1",
    "https://api.deepseek.com/responses",
    "https://api.deepseek.com?redirect=evil",
    "https://api.deepseek.com#fragment",
  ]) {
    assert.throws(
      () => loadConfig({ DEMO_INVITE_CODES: "test", DEEPSEEK_BASE_URL: unsafe }),
      /official DeepSeek|api\.deepseek\.com/i,
    );
  }
});

test("config defaults to DeepSeek v4 flash and allows only flash or pro", () => {
  const defaultConfig = loadConfig({ DEMO_INVITE_CODES: "test" });
  assert.equal(defaultConfig.deepseek.model, "deepseek-v4-flash");
  assert.equal(defaultConfig.deepseek.timeoutMs, 90_000);

  for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
    assert.equal(
      loadConfig({ DEMO_INVITE_CODES: "test", DEEPSEEK_MODEL: model }).deepseek.model,
      model,
    );
  }

  for (const model of ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-ultra", "other-model"]) {
    assert.throws(
      () => loadConfig({ DEMO_INVITE_CODES: "test", DEEPSEEK_MODEL: model }),
      /DeepSeek model|deepseek-v4-(?:flash|pro)/i,
    );
  }
});
