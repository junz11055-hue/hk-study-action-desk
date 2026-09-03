import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CORE_CANDIDATE_SCHEMA_VERSION,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  assertValidPhase2bEvaluationRecord,
  computePhase2bEvaluationHash,
} from "../../src/v2/contracts/phase2b-evaluation-record-v1.schema.js";
import {
  PHASE2B_DEEPSEEK_MODEL,
  PHASE2B_MAX_OUTPUT_TOKENS,
  PHASE2B_TIMEOUT_MS,
} from "../../src/v2/model/phase2-core-model-adapter.js";
import { CORE_PROMPT_VERSION } from "../../src/v2/prompts/notification-analysis-core-p1-v2.js";
import { PHASE2_DEVELOPMENT_CASE_IDS } from "../../src/v2/phase2/development-input-loader.js";
import { loadPhase2EvaluationDevelopmentCases } from "../../src/v2/phase2/phase2-evaluation-truth-loader.js";
import { capturePhase2bCandidates } from "../../src/v2/phase2/phase2b-candidate-capture.js";
import {
  PHASE2B_AUTHORIZATION_VERSION,
  createPhase2bAuthorizationMarker,
  phase2bRunDirectory,
} from "../../src/v2/phase2/phase2b-capture-store.js";
import { runPhase2bEvaluation } from "../../src/v2/phase2/phase2b-evaluation-runner.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { createFakePhase2bDeepSeekClient, referenceCandidatesByInputHash } from "./phase2b-test-helpers.js";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const COMMIT = "b".repeat(40);

async function tempRuntime(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "phase2b-eval-"));
  const canonical = await realpath(directory);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

function marker() {
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
  };
}

async function capturedRuntime(t, { mutateCandidate } = {}) {
  const runtimeDirectory = await tempRuntime(t);
  await createPhase2bAuthorizationMarker(marker(), { runtimeDirectory });
  const candidates = await referenceCandidatesByInputHash();
  const fake = createFakePhase2bDeepSeekClient({ candidates, mutateCandidate });
  await capturePhase2bCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
  });
  return { runtimeDirectory, fake };
}

test("Phase 2B evaluates only after all 16 captures are hash-verified", async (t) => {
  const { runtimeDirectory } = await capturedRuntime(t);
  let captureReads = 0;
  const result = await runPhase2bEvaluation({
    runtimeDirectory,
    readCaptureImpl: async (filePath) => {
      captureReads += 1;
      return JSON.parse(await readFile(filePath, "utf8"));
    },
    loadTruthImpl: async (options) => {
      assert.equal(captureReads, 33);
      return await loadPhase2EvaluationDevelopmentCases(options);
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.record.status, "awaiting_manual_review");
  assert.equal(result.record.summary.provider_request_count, 16);
  assert.equal(result.record.summary.valid_candidate_count, 16);
  assert.equal(result.record.summary.automatic_passed_case_count, 16);
  assert.equal(result.record.summary.pending_manual_review_count, 80);
  assert.equal(result.record.summary.total_input_tokens, 1720);
  assert.equal(result.record.summary.total_output_tokens, 3320);
  assertValidPhase2bEvaluationRecord(result.record);
  const serialized = JSON.stringify(result.record);
  assert.doesNotMatch(serialized, /test-key-canary-not-for-records/u);
  assert.equal(Object.hasOwn(result.record.cases[0], "candidate"), false);
});

test("An invalid captured Candidate remains in the denominator and fails technically", async (t) => {
  const { runtimeDirectory, fake } = await capturedRuntime(t, {
    mutateCandidate(candidate, index) {
      if (index === 4) candidate.title_zh = "invalid-no-han";
    },
  });
  const result = await runPhase2bEvaluation({ runtimeDirectory });
  assert.equal(fake.calls.length, 16);
  assert.equal(result.exitCode, 5);
  assert.equal(result.record.status, "technical_failed");
  assert.equal(result.record.summary.valid_candidate_count, 15);
  assert.equal(result.record.summary.technical_invalid_case_count, 1);
  assert.equal(result.record.cases[4].automatic, null);
  assert.equal(result.record.cases[4].errors[0].severity, "P0");
});

test("Phase 2B evaluation record rejects premature manual approval", async (t) => {
  const { runtimeDirectory } = await capturedRuntime(t);
  const result = await runPhase2bEvaluation({ runtimeDirectory });
  const drifted = JSON.parse(JSON.stringify(result.record));
  drifted.cases[0].review_queue[0].status = "pass";
  drifted.canonical_evaluation_hash = computePhase2bEvaluationHash(drifted);
  assert.throws(
    () => assertValidPhase2bEvaluationRecord(drifted),
    /five pending items/u,
  );
});

test("Phase 2B evaluation record rejects raw or unapproved nested fields", async (t) => {
  const { runtimeDirectory } = await capturedRuntime(t);
  const result = await runPhase2bEvaluation({ runtimeDirectory });

  const rawCandidateLeak = JSON.parse(JSON.stringify(result.record));
  rawCandidateLeak.cases[0].candidate = { forbidden: "raw-candidate" };
  rawCandidateLeak.canonical_evaluation_hash = computePhase2bEvaluationHash(
    rawCandidateLeak,
  );
  assert.throws(
    () => assertValidPhase2bEvaluationRecord(rawCandidateLeak),
    /unapproved fields|case envelope/u,
  );

  const attemptLeak = JSON.parse(JSON.stringify(result.record));
  attemptLeak.cases[0].attempt.api_key = "secret-canary";
  attemptLeak.canonical_evaluation_hash = computePhase2bEvaluationHash(attemptLeak);
  assert.throws(
    () => assertValidPhase2bEvaluationRecord(attemptLeak),
    /attempt record/u,
  );
});

test("Phase 2B rejects a hash-self-consistent intent that drifts from the frozen request", async (t) => {
  const { runtimeDirectory } = await capturedRuntime(t);
  const directory = phase2bRunDirectory(RUN_ID, { runtimeDirectory });
  const indexPath = path.join(directory, "capture-index.json");
  const intentPath = path.join(directory, "01-DEV001.intent.json");
  const terminalPath = path.join(directory, "01-DEV001.terminal.json");
  const [index, intent, terminal] = await Promise.all(
    [indexPath, intentPath, terminalPath].map(async (filePath) =>
      JSON.parse(await readFile(filePath, "utf8"))),
  );
  intent.model = "unapproved-model";
  terminal.intent_hash = hashCanonicalJson(intent);
  index.terminals[0].terminal_hash = hashCanonicalJson(terminal);
  let truthLoads = 0;
  await assert.rejects(
    runPhase2bEvaluation({
      runtimeDirectory,
      readCaptureImpl: async (filePath) => {
        if (filePath === indexPath) return index;
        if (filePath === intentPath) return intent;
        if (filePath === terminalPath) return terminal;
        return JSON.parse(await readFile(filePath, "utf8"));
      },
      loadTruthImpl: async () => {
        truthLoads += 1;
        return [];
      },
    }),
    /hash verification/u,
  );
  assert.equal(truthLoads, 0);
});

test("Phase 2B evaluation record is no-clobber", async (t) => {
  const { runtimeDirectory } = await capturedRuntime(t);
  await runPhase2bEvaluation({ runtimeDirectory });
  await assert.rejects(
    runPhase2bEvaluation({ runtimeDirectory }),
    /could not be persisted/u,
  );
});
