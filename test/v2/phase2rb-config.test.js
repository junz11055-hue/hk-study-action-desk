import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASE2RB_BASE_URL,
  PHASE2RB_MODEL,
  PHASE2RB_TIMEOUT_MS,
} from "../../src/v2/phase2rb/phase2rb-run-contract.js";
import {
  loadPhase2rbDeepSeekConfig,
  Phase2rbDeepSeekConfigurationError,
} from "../../src/v2/phase2rb/phase2rb-deepseek-config.js";

const KEY_CANARY = "phase2rb-key-canary-never-log";

async function loadWith(env, readEnvFileImpl = async () => null) {
  return await loadPhase2rbDeepSeekConfig({
    env,
    readEnvFileImpl,
    repositoryRoot: "/synthetic/repository",
  });
}

test("Phase 2R-B config accepts only the frozen DeepSeek transport", async () => {
  const config = await loadWith({ DEEPSEEK_API_KEY: KEY_CANARY });
  assert.deepEqual(config, {
    apiKey: KEY_CANARY,
    model: PHASE2RB_MODEL,
    baseUrl: PHASE2RB_BASE_URL,
    timeoutMs: PHASE2RB_TIMEOUT_MS,
  });
});

test("Phase 2R-B config fails closed for missing, malformed, or drifted values", async (t) => {
  const cases = [
    {},
    { DEEPSEEK_API_KEY: "" },
    { DEEPSEEK_API_KEY: "contains whitespace" },
    { DEEPSEEK_API_KEY: KEY_CANARY, DEEPSEEK_MODEL: "other-model" },
    {
      DEEPSEEK_API_KEY: KEY_CANARY,
      DEEPSEEK_BASE_URL: "https://example.invalid",
    },
    { DEEPSEEK_API_KEY: KEY_CANARY, DEEPSEEK_TIMEOUT_MS: "1" },
    { DEEPSEEK_API_KEY: KEY_CANARY, DEEPSEEK_TIMEOUT_MS: "not-a-number" },
  ];

  for (const env of cases) {
    await t.test(JSON.stringify(Object.keys(env)), async () => {
      await assert.rejects(
        loadWith(env),
        (error) =>
          error instanceof Phase2rbDeepSeekConfigurationError &&
          error.code === "model_configuration_invalid" &&
          !error.message.includes(KEY_CANARY),
      );
    });
  }
});

test("Phase 2R-B config converts env-file read failures into a redacted error", async () => {
  await assert.rejects(
    loadWith({ DEEPSEEK_API_KEY: KEY_CANARY }, () => {
      const error = new Error(`do-not-leak-${KEY_CANARY}`);
      error.code = "EACCES";
      throw error;
    }),
    (error) =>
      error instanceof Phase2rbDeepSeekConfigurationError &&
      error.code === "model_configuration_invalid" &&
      !error.message.includes(KEY_CANARY),
  );
});

test("A missing optional .env file does not weaken the explicit config contract", async () => {
  const config = await loadWith(
    { DEEPSEEK_API_KEY: KEY_CANARY },
    async () => null,
  );
  assert.equal(config.apiKey, KEY_CANARY);
  assert.equal(config.model, PHASE2RB_MODEL);
});
