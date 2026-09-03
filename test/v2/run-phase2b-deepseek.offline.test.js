import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../../src/v2/phase2/run-phase2b-deepseek.js";
import { createFakePhase2bDeepSeekClient, referenceCandidatesByInputHash } from "./phase2b-test-helpers.js";

const COMMIT = "c".repeat(40);

function sink() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
    },
    get value() {
      return value;
    },
  };
}

async function tempRuntime(t) {
  const created = await mkdtemp(path.join(os.tmpdir(), "phase2b-entry-"));
  const canonical = await realpath(created);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

test("invalid Phase 2B CLI stops before Git, marker, Key, or capture", async () => {
  const calls = { inspect: 0, config: 0, capture: 0 };
  const result = await main(["--case", "DEV001"], {
    implementationInspector: async () => { calls.inspect += 1; },
    configLoader: async () => { calls.config += 1; },
    captureImpl: async () => { calls.capture += 1; },
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(calls, { inspect: 0, config: 0, capture: 0 });
});

test("dirty Git stops before marker and Key access", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  let configCalls = 0;
  const result = await main([], {
    runtimeDirectory,
    implementationInspector: async () => {
      throw new Error("dirty");
    },
    configLoader: async () => { configCalls += 1; },
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(result.exitCode, 3);
  assert.equal(configCalls, 0);
  await assert.rejects(readFile(path.join(runtimeDirectory, "authorization-consumed.json")));
});

test("Git drift after Key load consumes authorization but performs zero requests", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  let inspections = 0;
  let captures = 0;
  const result = await main([], {
    runtimeDirectory,
    implementationInspector: async () => ({
      commitSha: inspections++ === 0 ? COMMIT : "d".repeat(40),
      gitClean: true,
    }),
    configLoader: async () => ({
      apiKey: "key-canary",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 90_000,
    }),
    captureImpl: async () => { captures += 1; },
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(result.exitCode, 3);
  assert.equal(captures, 0);
  assert.equal(
    JSON.parse(await readFile(path.join(runtimeDirectory, "authorization-consumed.json"))).status,
    "consumed",
  );
  const terminal = JSON.parse(await readFile(result.batchTerminalPath, "utf8"));
  assert.equal(terminal.error.code, "implementation_not_frozen");
  assert.equal(terminal.provider_request_count, 0);
  assert.equal(terminal.attempted_case_count, 0);
  assert.equal(terminal.unattempted_case_count, 16);
});

test("configuration failure after authorization writes one immutable zero-attempt terminal", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const result = await main([], {
    runtimeDirectory,
    implementationInspector: async () => ({ commitSha: COMMIT, gitClean: true }),
    configLoader: async () => {
      const error = new Error("synthetic missing config");
      error.code = "model_configuration_invalid";
      throw error;
    },
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(result.exitCode, 3);
  const terminal = JSON.parse(await readFile(result.batchTerminalPath, "utf8"));
  assert.equal(terminal.kind, "batch_terminal");
  assert.equal(terminal.error.code, "model_configuration_invalid");
  assert.equal(terminal.request_intent_count, 0);
  assert.equal(terminal.provider_request_count, 0);
  assert.equal(terminal.case_terminal_count, 0);
  assert.equal(terminal.unattempted_case_count, 16);
});

test("an injected capture failure after authorization is durably closed", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const result = await main([], {
    runtimeDirectory,
    implementationInspector: async () => ({ commitSha: COMMIT, gitClean: true }),
    configLoader: async () => ({
      apiKey: "capture-failure-key-canary",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 90_000,
    }),
    captureImpl: async () => {
      const error = new Error("synthetic capture failure");
      error.code = "phase2b_capture_incomplete";
      throw error;
    },
    stdout: sink(),
    stderr: sink(),
  });
  assert.equal(result.exitCode, 5);
  const terminal = JSON.parse(await readFile(result.batchTerminalPath, "utf8"));
  assert.equal(terminal.error.code, "phase2b_capture_incomplete");
  assert.equal(terminal.provider_request_count, 0);
  assert.equal(terminal.unattempted_case_count, 16);
  assert.doesNotMatch(JSON.stringify(terminal), /capture-failure-key-canary/u);
});

test("a completed offline fake entry captures 16 once and restart is blocked", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = createFakePhase2bDeepSeekClient({
    candidates,
    apiKey: "entry-key-canary-not-for-output",
  });
  const stdout = sink();
  const stderr = sink();
  const options = {
    runtimeDirectory,
    implementationInspector: async () => ({ commitSha: COMMIT, gitClean: true }),
    configLoader: async () => ({
      apiKey: "entry-key-canary-not-for-output",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 90_000,
    }),
    modelClientFactory: () => fake.client,
    stdout,
    stderr,
  };
  const first = await main([], options);
  assert.equal(first.exitCode, 0);
  assert.equal(fake.calls.length, 16);
  const combined = `${stdout.value}\n${stderr.value}`;
  assert.doesNotMatch(combined, /entry-key-canary-not-for-output/u);

  let configCalls = 0;
  const second = await main([], {
    ...options,
    configLoader: async () => {
      configCalls += 1;
      return options.configLoader();
    },
  });
  assert.equal(second.exitCode, 3);
  assert.equal(configCalls, 0);
  assert.equal(fake.calls.length, 16);
});
