import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  computePhase2EvaluationHash,
  PHASE2A_SAFETY_ASSURANCE,
  PHASE2_DEVELOPMENT_CASE_IDS,
  validatePhase2EvaluationRecord,
} from "../../src/v2/contracts/phase2-evaluation-record-v1.schema.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import { evaluateCoreCandidateSemantics } from "../../src/v2/phase2/core-semantic-evaluator.js";
import { loadPhase2DevelopmentInputs } from "../../src/v2/phase2/development-input-loader.js";
import { runPhase2aOffline } from "../../src/v2/phase2/phase2a-offline-runner.js";
import { validatePhase2CoreCandidate } from "../../src/v2/validation/phase2-core-candidate-validator.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const FIXED_TIME = "2026-08-31T08:00:00.000Z";
const ANSWER_FREE_INPUT_SNAPSHOT = "phase2-development-inputs-v1.json";
const EVALUATION_DEVELOPMENT_FIXTURE = "base-development.json";
const DEVELOPMENT_FIXTURE_URL = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

function captureStream() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
      },
    },
    value: () => value,
  };
}

function openedBasename(file) {
  if (file instanceof URL) return path.basename(fileURLToPath(file));
  return path.basename(String(file));
}

async function temporaryRecordsDirectory(t, prefix = "phase2a-offline-") {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), prefix));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return path.join(root, "evaluations");
}

async function actualReferenceResults() {
  const projectedInputs = await loadPhase2DevelopmentInputs();
  const developmentCases = JSON.parse(
    await readFile(DEVELOPMENT_FIXTURE_URL, "utf8"),
  );
  const byCaseId = new Map(
    developmentCases.map((developmentCase) => [
      developmentCase.case_id,
      developmentCase,
    ]),
  );

  return projectedInputs.map((projectedInput) => {
    const developmentCase = byCaseId.get(projectedInput.caseId);
    const oracle = projectCoreOverlapOracle(developmentCase);
    const candidate = buildReferenceCoreCandidateForEvaluation(
      developmentCase,
      oracle,
    );
    const candidateHashBefore = hashCanonicalJson(candidate);
    assert.strictEqual(
      validatePhase2CoreCandidate(candidate, projectedInput.modelInput),
      candidate,
    );
    const evaluation = evaluateCoreCandidateSemantics({
      oracle,
      candidate,
      modelInput: projectedInput.modelInput,
    });
    const candidateHashAfter = hashCanonicalJson(candidate);
    return {
      projectedInput,
      oracle,
      evaluation,
      candidateHashBefore,
      candidateHashAfter,
    };
  });
}

test("fixed Phase 2A command evaluates and atomically records 16/16 references offline", async (t) => {
  const recordsDirectory = await temporaryRecordsDirectory(t);
  const stdout = captureStream();
  const stderr = captureStream();
  const opened = [];
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network is forbidden in Phase 2A");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runPhase2aOffline({
    argv: [],
    recordsDirectory,
    readFileImpl: async (file, encoding) => {
      const basename = openedBasename(file);
      opened.push(basename);
      const source = await readFile(file, encoding);
      if (basename === ANSWER_FREE_INPUT_SNAPSHOT) {
        assert.doesNotMatch(source, /"expected"\s*:/u);
      }
      return source;
    },
    clock: () => new Date(FIXED_TIME),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.status, "succeeded");
  assert.deepEqual(opened, [
    ANSWER_FREE_INPUT_SNAPSHOT,
    EVALUATION_DEVELOPMENT_FIXTURE,
  ]);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.record.safety, {
    provider_requests: 0,
    network_connections: 0,
    locked_file_accesses: 0,
    secret_reads: 0,
    listening_ports: 0,
    real_data_records: 0,
  });
  assert.deepEqual(result.record.safety_assurance, PHASE2A_SAFETY_ASSURANCE);
  assert.deepEqual(
    result.record.evaluation.case_results.map(({ case_id: caseId }) => caseId),
    PHASE2_DEVELOPMENT_CASE_IDS,
  );
  assert.equal(result.record.evaluation.case_results.length, 16);
  assert.equal(result.record.evaluation.summary.evaluated_case_count, 16);
  assert.equal(
    result.record.evaluation.summary.automatic_passed_case_count,
    16,
  );
  assert.equal(result.record.evaluation.summary.automatic_failed_case_count, 0);
  assert.equal(result.record.evaluation.summary.technical_invalid_case_count, 0);
  assert.deepEqual(result.record.evaluation.summary.errors, {
    P0: 0,
    P1: 0,
    observation: 0,
  });
  assert.equal(
    result.record.canonical_evaluation_hash,
    computePhase2EvaluationHash(result.record),
  );
  assert.equal(
    validatePhase2EvaluationRecord(result.record).valid,
    true,
    JSON.stringify(validatePhase2EvaluationRecord(result.record).errors),
  );
  assert.match(stdout.value(), /"status":"succeeded"/u);
  assert.equal(stderr.value(), "");

  const persisted = JSON.parse(await readFile(result.recordPath, "utf8"));
  assert.deepEqual(persisted, result.record);
  assert.equal(validatePhase2EvaluationRecord(persisted).valid, true);
  const serializedRecord = JSON.stringify(persisted);
  assert.doesNotMatch(serializedRecord, /"candidate"\s*:/u);
  assert.doesNotMatch(
    serializedRecord,
    /authorization|bearer|api[_ -]?key|cookie|invite[_ -]?code/iu,
  );

  // Recompute with the actual Oracle, Candidate gate, and Evaluator. No stubbed
  // score is allowed to make the integration record pass.
  const expectedResults = await actualReferenceResults();
  expectedResults.forEach((expected, index) => {
    const actual = result.record.evaluation.case_results[index];
    assert.equal(actual.case_id, expected.projectedInput.caseId);
    assert.equal(
      actual.hashes.model_input_hash,
      expected.projectedInput.modelInputHash,
    );
    assert.equal(actual.hashes.oracle_hash, hashCanonicalJson(expected.oracle));
    assert.equal(
      actual.hashes.candidate_hash_before,
      expected.candidateHashBefore,
    );
    assert.equal(
      actual.hashes.candidate_hash_after,
      expected.candidateHashAfter,
    );
    assert.equal(expected.candidateHashAfter, expected.candidateHashBefore);
    assert.deepEqual(actual.automatic, expected.evaluation.automatic);
    assert.deepEqual(actual.errors, expected.evaluation.errors);
    assert.deepEqual(actual.review_queue, expected.evaluation.review_queue);
    assert.deepEqual(actual.excluded_fields, expected.evaluation.excluded_fields);
  });
});

test("invalid Phase 2A CLI stops before any fixture read and persists a controlled failure", async (t) => {
  const recordsDirectory = await temporaryRecordsDirectory(
    t,
    "phase2a-invalid-cli-",
  );
  const stderr = captureStream();
  let fixtureReads = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network is forbidden in Phase 2A");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runPhase2aOffline({
    argv: ["--case", "DEV001"],
    recordsDirectory,
    readFileImpl: async () => {
      fixtureReads += 1;
      throw new Error("invalid CLI must not read fixtures");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.record.status, "failed");
  assert.equal(result.record.error.code, "invalid_cli_input");
  assert.equal(result.record.evaluation.case_results.length, 0);
  assert.equal(fixtureReads, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(validatePhase2EvaluationRecord(result.record).valid, true);
  assert.match(stderr.value(), /"error":\{"code":"invalid_cli_input"\}/u);
  const persisted = JSON.parse(await readFile(result.recordPath, "utf8"));
  assert.deepEqual(persisted, result.record);
});

test("evaluation-only fixture failure is nonzero and leaves a valid terminal record", async (t) => {
  const recordsDirectory = await temporaryRecordsDirectory(
    t,
    "phase2a-evaluation-failure-",
  );
  const opened = [];
  const result = await runPhase2aOffline({
    argv: [],
    recordsDirectory,
    readFileImpl: async (file, encoding) => {
      const basename = openedBasename(file);
      opened.push(basename);
      if (basename === EVALUATION_DEVELOPMENT_FIXTURE) {
        throw new Error("synthetic evaluation-only read failure");
      }
      return await readFile(file, encoding);
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.exitCode, 5);
  assert.equal(result.record.status, "failed");
  assert.equal(result.record.error.code, "offline_evaluation_failed");
  assert.deepEqual(opened, [
    ANSWER_FREE_INPUT_SNAPSHOT,
    EVALUATION_DEVELOPMENT_FIXTURE,
  ]);
  assert.equal(result.record.evaluation.case_results.length, 0);
  assert.equal(validatePhase2EvaluationRecord(result.record).valid, true);
  const persisted = JSON.parse(await readFile(result.recordPath, "utf8"));
  assert.deepEqual(persisted, result.record);
});

test("evaluation truth mutations fail before Oracle or reference evaluation", async (t) => {
  const original = JSON.parse(await readFile(DEVELOPMENT_FIXTURE_URL, "utf8"));
  const mutations = [
    {
      name: "expected-only mutation",
      mutate(fixtures) {
        fixtures.find(({ case_id: caseId }) => caseId === "DEV001").expected
          .consequence.level = "high";
      },
    },
    {
      name: "source Input-only mutation",
      mutate(fixtures) {
        fixtures.find(({ case_id: caseId }) => caseId === "DEV001").input
          .message.subject += " [tampered]";
      },
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, async (subtest) => {
      const recordsDirectory = await temporaryRecordsDirectory(
        subtest,
        "phase2a-truth-mutation-",
      );
      const fixtures = structuredClone(original);
      mutation.mutate(fixtures);
      const tamperedSource = `${JSON.stringify(fixtures, null, 2)}\n`;

      const result = await runPhase2aOffline({
        argv: [],
        recordsDirectory,
        readFileImpl: async (file, encoding) => {
          if (openedBasename(file) === EVALUATION_DEVELOPMENT_FIXTURE) {
            return tamperedSource;
          }
          return await readFile(file, encoding);
        },
        clock: () => new Date(FIXED_TIME),
        stdout: captureStream().stream,
        stderr: captureStream().stream,
      });

      assert.equal(result.exitCode, 5);
      assert.equal(result.record.status, "failed");
      assert.equal(result.record.error.code, "offline_evaluation_failed");
      assert.equal(result.record.evaluation.case_results.length, 0);
      assert.equal(validatePhase2EvaluationRecord(result.record).valid, true);
    });
  }
});
