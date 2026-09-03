import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadPhase2rbRequestDescriptors,
} from "../../src/v2/phase2rb/phase2rb-candidate-capture.js";
import { main } from "../../src/v2/phase2rb/run-phase2rb-deepseek.js";
import {
  PHASE2RB_CASE_IDS,
  PHASE2RB_MAX_OUTPUT_TOKENS,
  PHASE2RB_MODEL,
  PHASE2RB_TIMEOUT_MS,
} from "../../src/v2/phase2rb/phase2rb-run-contract.js";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const COMMIT = "b".repeat(40);
const DRIFTED_COMMIT = "c".repeat(40);
const KEY_CANARY = "phase2rb-entry-key-canary-never-print";
const ERROR_CANARY = "phase2rb-entry-error-canary-never-print";

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
  const created = await mkdtemp(path.join(os.tmpdir(), "phase2rb-entry-"));
  const canonical = await realpath(created);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

function cleanImplementation() {
  return { gitClean: true, commitSha: COMMIT };
}

function frozenConfig() {
  return {
    apiKey: KEY_CANARY,
    model: PHASE2RB_MODEL,
    baseUrl: "https://api.deepseek.com",
    timeoutMs: PHASE2RB_TIMEOUT_MS,
  };
}

test("invalid Phase 2R-B CLI performs zero Git, descriptor, marker, Key, client, or capture work", async () => {
  const calls = {
    inspect: 0,
    descriptors: 0,
    marker: 0,
    config: 0,
    client: 0,
    capture: 0,
  };
  const stderr = sink();
  const result = await main(["--case", "DEV001"], {
    implementationInspector: async () => {
      calls.inspect += 1;
    },
    loadRequestDescriptorsImpl: async () => {
      calls.descriptors += 1;
    },
    createAuthorizationMarkerImpl: async () => {
      calls.marker += 1;
    },
    configLoader: async () => {
      calls.config += 1;
    },
    modelClientFactory: () => {
      calls.client += 1;
    },
    captureImpl: async () => {
      calls.capture += 1;
    },
    stdout: sink(),
    stderr,
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.runId, null);
  assert.deepEqual(calls, {
    inspect: 0,
    descriptors: 0,
    marker: 0,
    config: 0,
    client: 0,
    capture: 0,
  });
  assert.match(stderr.value, /"code":"invalid_cli_input"/u);
});

test("dirty Git stops before descriptors, marker, Key, client, or capture", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const calls = { descriptors: 0, marker: 0, config: 0, client: 0, capture: 0 };
  const result = await main([], {
    runId: RUN_ID,
    runtimeDirectory,
    implementationInspector: async () => {
      throw new Error(ERROR_CANARY);
    },
    loadRequestDescriptorsImpl: async () => {
      calls.descriptors += 1;
    },
    createAuthorizationMarkerImpl: async () => {
      calls.marker += 1;
    },
    configLoader: async () => {
      calls.config += 1;
    },
    modelClientFactory: () => {
      calls.client += 1;
    },
    captureImpl: async () => {
      calls.capture += 1;
    },
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(result.exitCode, 3);
  assert.deepEqual(calls, {
    descriptors: 0,
    marker: 0,
    config: 0,
    client: 0,
    capture: 0,
  });
  await assert.rejects(
    readFile(path.join(runtimeDirectory, "authorization-consumed.json")),
    (error) => error.code === "ENOENT",
  );
});

test("descriptor drift stops after clean Git but before marker or Key", async () => {
  const calls = { inspect: 0, marker: 0, config: 0, client: 0, capture: 0 };
  const result = await main([], {
    runId: RUN_ID,
    implementationInspector: async () => {
      calls.inspect += 1;
      return cleanImplementation();
    },
    loadRequestDescriptorsImpl: async () => {
      throw new Error(ERROR_CANARY);
    },
    createAuthorizationMarkerImpl: async () => {
      calls.marker += 1;
    },
    configLoader: async () => {
      calls.config += 1;
    },
    modelClientFactory: () => {
      calls.client += 1;
    },
    captureImpl: async () => {
      calls.capture += 1;
    },
    stdout: sink(),
    stderr: sink(),
  });

  assert.equal(result.exitCode, 3);
  assert.deepEqual(calls, {
    inspect: 1,
    marker: 0,
    config: 0,
    client: 0,
    capture: 0,
  });
});

test("runner consumes the marker before Key access and keeps four fake cases serial", async () => {
  const order = [];
  const stdout = sink();
  const stderr = sink();
  let inspection = 0;
  const result = await main([], {
    runId: RUN_ID,
    implementationInspector: async () => {
      inspection += 1;
      order.push(`git:${inspection}`);
      return cleanImplementation();
    },
    loadRequestDescriptorsImpl: async () => {
      order.push("descriptors");
      return await loadPhase2rbRequestDescriptors();
    },
    createAuthorizationMarkerImpl: async (marker) => {
      order.push("marker");
      assert.equal(marker.status, "consumed");
      assert.deepEqual(marker.case_ids, PHASE2RB_CASE_IDS);
      return { path: "/offline/authorization-consumed.json", snapshot: marker };
    },
    configLoader: async () => {
      order.push("config:key-access");
      assert.ok(order.includes("marker"));
      return frozenConfig();
    },
    modelClientFactory: (config) => {
      order.push("client");
      assert.equal(config.apiKey, KEY_CANARY);
      assert.equal(config.model, PHASE2RB_MODEL);
      assert.equal(config.maxRetries, 1);
      return Object.freeze({ offline: true, apiKey: KEY_CANARY });
    },
    captureImpl: async ({ beforeCasePreflight, onProgress, modelClient }) => {
      order.push("capture");
      assert.equal(modelClient.offline, true);
      for (let index = 0; index < PHASE2RB_CASE_IDS.length; index += 1) {
        const caseId = PHASE2RB_CASE_IDS[index];
        const preflight = await beforeCasePreflight({ caseId, caseIndex: index });
        assert.deepEqual(preflight, cleanImplementation());
        order.push(`fake-attempt:${caseId}`);
        onProgress({
          completed: index + 1,
          planned: PHASE2RB_CASE_IDS.length,
          case_id: caseId,
          status: "candidate_valid",
        });
      }
      return { captureIndexPath: "/offline/capture-index.json" };
    },
    stdout,
    stderr,
  });

  assert.equal(result.exitCode, 0);
  assert.ok(order.indexOf("git:1") < order.indexOf("descriptors"));
  assert.ok(order.indexOf("descriptors") < order.indexOf("marker"));
  assert.ok(order.indexOf("marker") < order.indexOf("config:key-access"));
  assert.ok(order.indexOf("config:key-access") < order.indexOf("git:2"));
  assert.ok(order.indexOf("git:2") < order.indexOf("client"));
  assert.deepEqual(
    order.filter((item) => item.startsWith("fake-attempt:")),
    PHASE2RB_CASE_IDS.map((caseId) => `fake-attempt:${caseId}`),
  );
  assert.equal(inspection, 2 + PHASE2RB_CASE_IDS.length);
  const output = `${stdout.value}\n${stderr.value}`;
  assert.doesNotMatch(output, new RegExp(KEY_CANARY, "u"));
  assert.doesNotMatch(output, new RegExp(ERROR_CANARY, "u"));
  assert.doesNotMatch(output, /candidate\s*:/iu);
});

test("Git drift after Key access consumes authorization and performs zero capture work", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  let inspections = 0;
  let configCalls = 0;
  let clientCalls = 0;
  let captureCalls = 0;
  const stdout = sink();
  const stderr = sink();
  const result = await main([], {
    runId: RUN_ID,
    runtimeDirectory,
    implementationInspector: async () => ({
      gitClean: true,
      commitSha: inspections++ === 0 ? COMMIT : DRIFTED_COMMIT,
    }),
    configLoader: async () => {
      configCalls += 1;
      return frozenConfig();
    },
    modelClientFactory: () => {
      clientCalls += 1;
    },
    captureImpl: async () => {
      captureCalls += 1;
    },
    stdout,
    stderr,
  });

  assert.equal(result.exitCode, 3);
  assert.equal(configCalls, 1);
  assert.equal(clientCalls, 0);
  assert.equal(captureCalls, 0);
  const marker = JSON.parse(
    await readFile(path.join(runtimeDirectory, "authorization-consumed.json"), "utf8"),
  );
  assert.equal(marker.status, "consumed");
  assert.equal(marker.implementation_commit_sha, COMMIT);
  const terminal = JSON.parse(await readFile(result.batchTerminalPath, "utf8"));
  assert.equal(terminal.error.code, "implementation_not_frozen");
  assert.equal(terminal.request_intent_count, 0);
  assert.equal(terminal.provider_request_count, 0);
  assert.equal(terminal.case_terminal_count, 0);
  assert.deepEqual(terminal.unattempted_case_ids, PHASE2RB_CASE_IDS);
  assert.doesNotMatch(`${stdout.value}\n${stderr.value}`, new RegExp(KEY_CANARY, "u"));
});

test("configuration failure leaves one immutable zero-attempt terminal without leaking details", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const stdout = sink();
  const stderr = sink();
  const first = await main([], {
    runId: RUN_ID,
    runtimeDirectory,
    implementationInspector: async () => cleanImplementation(),
    configLoader: async () => {
      const error = new Error(`${ERROR_CANARY}:${KEY_CANARY}`);
      error.code = "model_configuration_invalid";
      throw error;
    },
    stdout,
    stderr,
  });

  assert.equal(first.exitCode, 3);
  const authorizationPath = path.join(
    runtimeDirectory,
    "authorization-consumed.json",
  );
  assert.equal((await stat(authorizationPath)).mode & 0o777, 0o600);
  const before = await readFile(first.batchTerminalPath, "utf8");
  const terminal = JSON.parse(before);
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.error.code, "model_configuration_invalid");
  assert.equal(terminal.request_intent_count, 0);
  assert.equal(terminal.provider_request_count, 0);
  assert.equal(terminal.case_terminal_count, 0);
  assert.deepEqual(terminal.unattempted_case_ids, PHASE2RB_CASE_IDS);

  let secondConfigCalls = 0;
  const second = await main([], {
    runId: RUN_ID,
    runtimeDirectory,
    implementationInspector: async () => cleanImplementation(),
    configLoader: async () => {
      secondConfigCalls += 1;
      return frozenConfig();
    },
    stdout,
    stderr,
  });
  assert.equal(second.exitCode, 3);
  assert.equal(secondConfigCalls, 0);
  assert.equal(await readFile(first.batchTerminalPath, "utf8"), before);
  const output = `${stdout.value}\n${stderr.value}`;
  assert.doesNotMatch(output, new RegExp(KEY_CANARY, "u"));
  assert.doesNotMatch(output, new RegExp(ERROR_CANARY, "u"));
});
