import assert from "node:assert/strict";
import test from "node:test";

import { hashUtf8 } from "../../src/v2/validation/canonical-json.js";
import { loadPhase2alDeepSeekConfig } from "../../src/v2/phase2al/phase2al-deepseek-config.js";
import {
  inspectFrozenPhase2alImplementation,
  PHASE2AL_IMPLEMENTATION_MANIFEST_PATH,
} from "../../src/v2/phase2al/phase2al-git-preflight.js";

const USER_FILES_STATUS =
  "?? AI产品Vibe Coding通用前端技术栈手册.md\0?? 后端-前端.png\0";
const COMMIT = "c".repeat(40);

test("DeepSeek config loader uses only injected frozen values and never logs the Key", async () => {
  const config = await loadPhase2alDeepSeekConfig({
    env: { DEEPSEEK_API_KEY: "synthetic-test-key" },
    repositoryRoot: "/private/tmp/phase2al-config-test",
    readEnvFileImpl: async () => null,
  });
  assert.deepEqual(config, {
    apiKey: "synthetic-test-key",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    timeoutMs: 90_000,
  });
  assert.equal(JSON.stringify({ ...config, apiKey: "[redacted]" }).includes("synthetic-test-key"), false);

  await assert.rejects(
    loadPhase2alDeepSeekConfig({
      env: {},
      repositoryRoot: "/private/tmp/phase2al-config-test",
      readEnvFileImpl: async () => null,
    }),
    { code: "model_configuration_invalid" },
  );
});
test("Git preflight permits only the two preserved user files and verifies implementation hashes", async () => {
  const sources = new Map();
  for (let index = 0; index < 8; index += 1) {
    sources.set(`src/v2/phase2al/file-${index}.js`, `export const value${index} = ${index};\n`);
  }
  const manifest = {
    manifestVersion: "phase2al-implementation-manifest-v1",
    files: [...sources].map(([filePath, source]) => ({
      path: filePath,
      sha256: hashUtf8(source),
    })),
  };
  const readFileImpl = async (filePath) => {
    const relative = String(filePath).replace("/repo/", "");
    if (relative === PHASE2AL_IMPLEMENTATION_MANIFEST_PATH) {
      return JSON.stringify(manifest);
    }
    if (!sources.has(relative)) throw new Error("unexpected file");
    return sources.get(relative);
  };
  const execFileImpl = async (_command, args) => {
    if (args[0] === "status") return { stdout: USER_FILES_STATUS };
    return { stdout: `${COMMIT}\n` };
  };

  const result = await inspectFrozenPhase2alImplementation({
    repositoryRoot: "/repo",
    execFileImpl,
    readFileImpl,
  });
  assert.equal(result.commitSha, COMMIT);
  assert.equal(result.gitClean, true);
  assert.deepEqual([...result.allowedUntracked], [
    "AI产品Vibe Coding通用前端技术栈手册.md",
    "后端-前端.png",
  ]);

  await assert.rejects(
    inspectFrozenPhase2alImplementation({
      repositoryRoot: "/repo",
      execFileImpl: async (_command, args) =>
        args[0] === "status"
          ? { stdout: `${USER_FILES_STATUS}?? src/extra.js\0` }
          : { stdout: `${COMMIT}\n` },
      readFileImpl,
    }),
    { code: "implementation_not_frozen" },
  );
});
