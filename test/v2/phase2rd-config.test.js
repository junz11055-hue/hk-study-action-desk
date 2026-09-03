import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASE2RD_BASE_URL,
  PHASE2RD_MODEL,
  PHASE2RD_TIMEOUT_MS,
} from "../../src/v2/phase2rd/phase2rd-run-contract.js";
import {
  loadPhase2rdDeepSeekConfig,
  Phase2rdDeepSeekConfigurationError,
} from "../../src/v2/phase2rd/phase2rd-deepseek-config.js";
import {
  inspectFrozenPhase2rdImplementation,
} from "../../src/v2/phase2rd/phase2rd-git-preflight.js";

const KEY_CANARY = "phase2rd-key-canary-never-log";

async function loadWith(env, readEnvFileImpl = async () => null) {
  return await loadPhase2rdDeepSeekConfig({
    env,
    readEnvFileImpl,
    repositoryRoot: "/synthetic/repository",
  });
}

test("Phase 2R-D config accepts only the frozen DeepSeek transport", async () => {
  const config = await loadWith({ DEEPSEEK_API_KEY: KEY_CANARY });
  assert.deepEqual(config, {
    apiKey: KEY_CANARY,
    model: PHASE2RD_MODEL,
    baseUrl: PHASE2RD_BASE_URL,
    timeoutMs: PHASE2RD_TIMEOUT_MS,
  });
});

test("Phase 2R-D config fails closed for missing, malformed, or drifted values", async (t) => {
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
          error instanceof Phase2rdDeepSeekConfigurationError &&
          error.code === "model_configuration_invalid" &&
          !error.message.includes(KEY_CANARY),
      );
    });
  }
});

test("Phase 2R-D config converts env-file read failures into a redacted error", async () => {
  await assert.rejects(
    loadWith({ DEEPSEEK_API_KEY: KEY_CANARY }, () => {
      const error = new Error(`do-not-leak-${KEY_CANARY}`);
      error.code = "EACCES";
      throw error;
    }),
    (error) =>
      error instanceof Phase2rdDeepSeekConfigurationError &&
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
  assert.equal(config.model, PHASE2RD_MODEL);
});

test("Git preflight ignores only the two preserved user-owned untracked files", async () => {
  const calls = [];
  const result = await inspectFrozenPhase2rdImplementation({
    repositoryRoot: "/synthetic/repository",
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      return {
        stdout: args[0] === "status"
          ? "?? AI产品Vibe Coding通用前端技术栈手册.md\0?? 后端-前端.png\0"
          : `${"a".repeat(40)}\n`,
      };
    },
  });
  assert.equal(result.gitClean, true);
  assert.equal(result.commitSha, "a".repeat(40));
  assert.deepEqual(calls[0][1], [
    "status", "--porcelain=v1", "-z", "--untracked-files=all",
  ]);
});

test("Git preflight rejects tracked drift and any other untracked file", async () => {
  for (const status of [" M README.md\0", "?? unexpected.txt\0"]) {
    await assert.rejects(
      inspectFrozenPhase2rdImplementation({
        repositoryRoot: "/synthetic/repository",
        execFileImpl: async () => ({ stdout: status }),
      }),
      (error) => error.code === "implementation_not_frozen",
    );
  }
});
