import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validatePhase1CoreRunRecord } from "../../src/v2/contracts/phase1-core-run-record-v2.schema.js";
import { createDev001CoreMockCandidate } from "../../src/v2/model/phase1-core-model-adapter.js";
import { DEFAULT_PHASE1_SMOKE_LOCK_PATH } from "../../src/v2/phase1/run-phase1-smoke.js";
import {
  acquirePhase1CoreSmokeLock,
  assertPhase1CoreDeepSeekConfiguration,
  DEFAULT_PHASE1_CORE_SMOKE_LOCK_PATH,
  inspectFrozenCoreImplementation,
  main as runCoreSmoke,
  Phase1CoreConfigurationError,
  Phase1CoreImplementationPreflightError,
} from "../../src/v2/phase1/run-phase1-core-smoke.js";

const FIXED_TIME = "2026-08-31T00:00:00.000Z";
const COMMIT_SHA = "a".repeat(40);

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    value: () => value,
  };
}

async function temporaryCoreSmoke(t) {
  const root = await mkdtemp(path.join(tmpdir(), "phase1-core-smoke-offline-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return {
    runsDirectory: path.join(root, "runs"),
    lockPath: path.join(root, "smoke.lock"),
  };
}

function frozenImplementation() {
  return { commitSha: COMMIT_SHA, gitClean: true };
}

function fixedConfig(apiKey = "") {
  return {
    deepseek: {
      apiKey,
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 90_000,
      maxRetries: 4,
    },
  };
}

function successfulProviderResponse(candidate) {
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async json() {
      return {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(candidate) }],
          },
        ],
        usage: { input_tokens: 500, output_tokens: 900 },
      };
    },
  };
}

test("Core and legacy real smoke entries share one exclusive lock path", () => {
  assert.equal(DEFAULT_PHASE1_CORE_SMOKE_LOCK_PATH, DEFAULT_PHASE1_SMOKE_LOCK_PATH);
});

test("Core smoke invalid CLI has zero lock, Git, config, Key, or transport work", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  let inspections = 0;
  let configLoads = 0;
  let fetches = 0;
  const result = await runCoreSmoke(["--case", "DEV002"], {
    ...temporary,
    implementationInspector: async () => {
      inspections += 1;
      return frozenImplementation();
    },
    configLoader: async () => {
      configLoads += 1;
      return fixedConfig("must-not-read");
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.record.error.code, "invalid_cli_input");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(inspections, 0);
  assert.equal(configLoads, 0);
  assert.equal(fetches, 0);
  await assert.rejects(stat(temporary.lockPath), { code: "ENOENT" });
});

test("Core smoke lock blocks Git, config, Key, and transport, then records a safe failure", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  const owner = await acquirePhase1CoreSmokeLock({
    lockPath: temporary.lockPath,
    runId: "88888888-8888-4888-8888-888888888888",
    clock: () => new Date(FIXED_TIME),
  });
  let inspections = 0;
  let configLoads = 0;
  const result = await runCoreSmoke(["--case", "DEV001"], {
    ...temporary,
    implementationInspector: async () => {
      inspections += 1;
      return frozenImplementation();
    },
    configLoader: async () => {
      configLoads += 1;
      return fixedConfig("must-not-read");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });
  await owner.release();

  assert.equal(result.record.error.code, "smoke_lock_unavailable");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(inspections, 0);
  assert.equal(configLoads, 0);
  assert.equal(validatePhase1CoreRunRecord(result.record).valid, true);
});

test("Core smoke dirty Git stops before config or transport and releases the lock", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  let configLoads = 0;
  let fetches = 0;
  const result = await runCoreSmoke(["--case", "DEV001"], {
    ...temporary,
    implementationInspector: async () => {
      throw new Phase1CoreImplementationPreflightError();
    },
    configLoader: async () => {
      configLoads += 1;
      return fixedConfig("must-not-read");
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.record.error.code, "implementation_not_frozen");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(configLoads, 0);
  assert.equal(fetches, 0);
  await assert.rejects(stat(temporary.lockPath), { code: "ENOENT" });
});

test("Core smoke rejects configuration drift before constructing a client", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  let fetches = 0;
  const config = fixedConfig("offline-only");
  config.deepseek.timeoutMs = 89_999;
  const result = await runCoreSmoke(["--case", "DEV001"], {
    ...temporary,
    implementationInspector: async () => frozenImplementation(),
    configLoader: async () => config,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.record.error.code, "model_configuration_invalid");
  assert.equal(result.record.implementation_commit_sha, COMMIT_SHA);
  assert.equal(result.record.implementation_git_clean, true);
  assert.equal(result.record.attempts.length, 0);
  assert.equal(fetches, 0);
});

test("Core smoke rechecks Git after config and still stops before transport", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  let inspections = 0;
  let fetches = 0;
  const result = await runCoreSmoke(["--case", "DEV001"], {
    ...temporary,
    implementationInspector: async () => {
      inspections += 1;
      if (inspections === 1) return frozenImplementation();
      throw new Phase1CoreImplementationPreflightError();
    },
    configLoader: async () => fixedConfig("offline-only"),
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(inspections, 2);
  assert.equal(fetches, 0);
  assert.equal(result.record.error.code, "implementation_not_frozen");
  assert.equal(result.record.implementation_commit_sha, COMMIT_SHA);
  assert.equal(result.record.implementation_git_clean, false);
  assert.equal(result.record.attempts.length, 0);
});

test("Core smoke with an empty injected Key performs zero fetches", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  let fetches = 0;
  const result = await runCoreSmoke(["--case", "DEV001"], {
    ...temporary,
    implementationInspector: async () => frozenImplementation(),
    configLoader: async () => fixedConfig(""),
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.record.error.code, "model_not_configured");
  assert.equal(result.record.model, "deepseek-v4-flash");
  assert.equal(result.record.provider_endpoint, "https://api.deepseek.com");
  assert.equal(result.record.implementation_commit_sha, COMMIT_SHA);
  assert.equal(result.record.implementation_git_clean, true);
  assert.equal(result.record.attempts.length, 0);
  assert.equal(fetches, 0);
});

test("Core smoke offline fake path makes exactly one attempt and releases its lock", async (t) => {
  const temporary = await temporaryCoreSmoke(t);
  let fetches = 0;
  const candidate = createDev001CoreMockCandidate();
  const result = await runCoreSmoke(["--case", "DEV001"], {
    ...temporary,
    implementationInspector: async () => frozenImplementation(),
    configLoader: async () => fixedConfig("offline-test-key-never-sent"),
    fetchImpl: async () => {
      fetches += 1;
      return successfulProviderResponse(candidate);
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(fetches, 1);
  assert.equal(result.record.status, "succeeded");
  assert.equal(result.record.attempts.length, 1);
  assert.equal(result.record.attempts[0].http_status, 200);
  assert.equal(result.record.attempts[0].provider_status, "completed");
  assert.equal(result.record.decoding.max_attempts, 1);
  assert.equal(result.record.decoding.max_output_tokens, 8_000);
  assert.equal(result.record.decoding.timeout_ms, 90_000);
  assert.equal(result.record.implementation_commit_sha, COMMIT_SHA);
  assert.equal(result.record.implementation_git_clean, true);
  assert.equal(validatePhase1CoreRunRecord(result.record).valid, true);
  await assert.rejects(stat(temporary.lockPath), { code: "ENOENT" });

  const persisted = JSON.parse(await readFile(result.recordPath, "utf8"));
  assert.doesNotMatch(
    JSON.stringify(persisted),
    /offline-test-key|authorization|raw_response|partial_output_text/iu,
  );
});

test("Core Git preflight uses fixed read-only commands and rejects dirty status", async () => {
  const calls = [];
  const clean = await inspectFrozenCoreImplementation({
    repositoryRoot: "/synthetic/repository",
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return args[0] === "status" ? { stdout: "" } : { stdout: `${COMMIT_SHA}\n` };
    },
  });
  assert.deepEqual(clean, { commitSha: COMMIT_SHA, gitClean: true });
  assert.deepEqual(calls.map((call) => call.command), ["git", "git"]);
  assert.deepEqual(calls[0].args, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  assert.deepEqual(calls[1].args, ["rev-parse", "--verify", "HEAD^{commit}"]);
  assert.ok(calls.every((call) => call.options.cwd === "/synthetic/repository"));

  await assert.rejects(
    inspectFrozenCoreImplementation({
      execFileImpl: async () => ({ stdout: " M src/file.js\n" }),
    }),
    Phase1CoreImplementationPreflightError,
  );
});

test("Core configuration validator locks model, endpoint, and timeout", () => {
  assert.equal(
    assertPhase1CoreDeepSeekConfiguration(fixedConfig("offline")).model,
    "deepseek-v4-flash",
  );
  for (const mutate of [
    (value) => { value.deepseek.model = "deepseek-v4-pro"; },
    (value) => { value.deepseek.baseUrl = "https://example.invalid"; },
    (value) => { value.deepseek.timeoutMs = 89_999; },
  ]) {
    const value = fixedConfig("offline");
    mutate(value);
    assert.throws(
      () => assertPhase1CoreDeepSeekConfiguration(value),
      Phase1CoreConfigurationError,
    );
  }
});
