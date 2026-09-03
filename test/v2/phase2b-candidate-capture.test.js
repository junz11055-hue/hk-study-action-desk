import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Phase2bRequestBudget,
  capturePhase2bCandidates,
} from "../../src/v2/phase2/phase2b-candidate-capture.js";
import { CORE_CANDIDATE_SCHEMA_VERSION } from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE2B_DEEPSEEK_MODEL,
  PHASE2B_MAX_OUTPUT_TOKENS,
  PHASE2B_TIMEOUT_MS,
} from "../../src/v2/model/phase2-core-model-adapter.js";
import { CORE_PROMPT_VERSION } from "../../src/v2/prompts/notification-analysis-core-p1-v2.js";
import {
  PHASE2B_AUTHORIZATION_VERSION,
  createPhase2bAuthorizationMarker,
  phase2bRunDirectory,
} from "../../src/v2/phase2/phase2b-capture-store.js";
import { PHASE2_DEVELOPMENT_CASE_IDS } from "../../src/v2/phase2/development-input-loader.js";
import { createFakePhase2bDeepSeekClient, referenceCandidatesByInputHash } from "./phase2b-test-helpers.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const COMMIT = "a".repeat(40);

function authorizationMarker(overrides = {}) {
  return {
    authorization_version: PHASE2B_AUTHORIZATION_VERSION,
    status: "consumed",
    run_id: RUN_ID,
    consumed_at: "2026-08-31T10:00:00.000Z",
    implementation_commit_sha: COMMIT,
    case_ids: [...PHASE2_DEVELOPMENT_CASE_IDS],
    provider: "deepseek",
    model: PHASE2B_DEEPSEEK_MODEL,
    prompt_version: CORE_PROMPT_VERSION,
    candidate_schema_version: CORE_CANDIDATE_SCHEMA_VERSION,
    max_requests: 16,
    requests_per_case: 1,
    serial: true,
    retries: 0,
    max_output_tokens: PHASE2B_MAX_OUTPUT_TOKENS,
    timeout_ms: PHASE2B_TIMEOUT_MS,
    data_scope: "synthetic_development_only",
    ...overrides,
  };
}

async function tempRuntime(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "phase2b-capture-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  return await realpath(directory);
}

test("Phase 2B captures 16 cases serially with one durable intent and terminal each", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = createFakePhase2bDeepSeekClient({ candidates });
  await createPhase2bAuthorizationMarker(
    authorizationMarker(),
    { runtimeDirectory },
  );
  const result = await capturePhase2bCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
  });
  assert.equal(fake.calls.length, 16);
  assert.equal(fake.maxActive, 1);
  assert.deepEqual(
    fake.calls.map(({ modelInput }) => modelInput.message.subject),
    (await import("../../docs/fixtures/prd-v0.2/phase2-development-inputs-v1.json", { with: { type: "json" } })).default.cases.map(({ modelInput }) => modelInput.message.subject),
  );
  assert.equal(result.captureIndex.provider_request_count, 16);
  const files = await readdir(phase2bRunDirectory(RUN_ID, { runtimeDirectory }));
  assert.equal(files.filter((name) => name.endsWith(".intent.json")).length, 16);
  assert.equal(files.filter((name) => name.endsWith(".terminal.json")).length, 16);
  assert.equal(files.filter((name) => name === "capture-index.json").length, 1);
  for (const name of files.filter((item) => item.endsWith(".json"))) {
    assert.equal((await stat(path.join(phase2bRunDirectory(RUN_ID, { runtimeDirectory }), name))).mode & 0o777, 0o600);
  }
  const allText = await Promise.all(
    files.filter((name) => name.endsWith(".json")).map((name) =>
      readFile(path.join(phase2bRunDirectory(RUN_ID, { runtimeDirectory }), name), "utf8")),
  );
  assert.doesNotMatch(allText.join("\n"), /test-key-canary-not-for-records/u);
});

test("Phase 2B content failure is captured once and never retried", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = createFakePhase2bDeepSeekClient({
    candidates,
    mutateCandidate(candidate, index) {
      if (index === 2) candidate.title_zh = "no-han-title";
    },
  });
  await createPhase2bAuthorizationMarker(authorizationMarker(), {
    runtimeDirectory,
  });
  const result = await capturePhase2bCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
  });
  assert.equal(fake.calls.length, 16);
  assert.equal(result.captureIndex.provider_request_count, 16);
  const terminal = JSON.parse(
    await readFile(
      path.join(
        phase2bRunDirectory(RUN_ID, { runtimeDirectory }),
        "03-DEV004.terminal.json",
      ),
      "utf8",
    ),
  );
  assert.equal(terminal.status, "candidate_invalid");
  assert.equal(terminal.error.code, "candidate_language_invalid");
  assert.equal(terminal.candidate, null);
});

test("Phase 2B request budget rejects duplicate, reordered, and seventeenth reservations", () => {
  const duplicate = new Phase2bRequestBudget();
  duplicate.reserve("DEV001");
  assert.throws(() => duplicate.reserve("DEV001"), /frozen order/u);
  const reordered = new Phase2bRequestBudget();
  assert.throws(() => reordered.reserve("DEV003"), /frozen order/u);
  const exhausted = new Phase2bRequestBudget();
  for (const caseId of PHASE2_DEVELOPMENT_CASE_IDS) exhausted.reserve(caseId);
  assert.throws(() => exhausted.reserve("DEV001"), /exceed 16/u);
});

test("A failed intent write prevents transport and closes the batch", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = createFakePhase2bDeepSeekClient({ candidates });
  await createPhase2bAuthorizationMarker(authorizationMarker(), {
    runtimeDirectory,
  });
  await assert.rejects(
    capturePhase2bCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: fake.client,
      runtimeDirectory,
      writeIntentImpl: async () => {
        throw new Error("intent unavailable");
      },
    }),
  );
  assert.equal(fake.calls.length, 0);
  const terminal = JSON.parse(
    await readFile(
      path.join(phase2bRunDirectory(RUN_ID, { runtimeDirectory }), "batch-terminal.json"),
      "utf8",
    ),
  );
  assert.equal(terminal.provider_request_count, 0);
  assert.equal(terminal.attempted_case_count, 0);
  assert.equal(terminal.unattempted_case_count, 16);
});

test("A failed terminal write stops before the next case and preserves counts", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = createFakePhase2bDeepSeekClient({ candidates });
  await createPhase2bAuthorizationMarker(authorizationMarker(), {
    runtimeDirectory,
  });
  await assert.rejects(
    capturePhase2bCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: fake.client,
      runtimeDirectory,
      writeIntentImpl: async (value) => ({ hash: `sha256:${"1".repeat(64)}`, snapshot: value }),
      writeTerminalImpl: async () => {
        throw new Error("terminal unavailable");
      },
    }),
  );
  assert.equal(fake.calls.length, 1);
  const terminal = JSON.parse(
    await readFile(
      path.join(phase2bRunDirectory(RUN_ID, { runtimeDirectory }), "batch-terminal.json"),
      "utf8",
    ),
  );
  assert.equal(terminal.request_intent_count, 1);
  assert.equal(terminal.provider_request_count, 1);
  assert.equal(terminal.case_terminal_count, 0);
  assert.equal(terminal.attempted_case_count, 1);
  assert.equal(terminal.unattempted_case_count, 15);
});

test("The transport core rejects a missing or drifted durable marker", async (t) => {
  const missingRuntime = await tempRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const missingFake = createFakePhase2bDeepSeekClient({ candidates });
  await assert.rejects(
    capturePhase2bCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: missingFake.client,
      runtimeDirectory: missingRuntime,
    }),
    (error) => error.code === "phase2b_authorization_marker_invalid",
  );
  assert.equal(missingFake.calls.length, 0);

  const driftedRuntime = await tempRuntime(t);
  await createPhase2bAuthorizationMarker(
    authorizationMarker({ max_requests: 17 }),
    { runtimeDirectory: driftedRuntime },
  );
  const driftedFake = createFakePhase2bDeepSeekClient({ candidates });
  await assert.rejects(
    capturePhase2bCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: driftedFake.client,
      runtimeDirectory: driftedRuntime,
    }),
    (error) => error.code === "phase2b_authorization_marker_invalid",
  );
  assert.equal(driftedFake.calls.length, 0);
});
