import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertValidPhase2EvaluationRecord,
  computePhase2EvaluationHash,
  PHASE2A_FAILURE_CLAIMS,
  PHASE2A_SAFETY_ASSURANCE,
  PHASE2A_SUCCESS_CLAIMS,
  PHASE2_AUTOMATIC_DIMENSION_NAMES,
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
  PHASE2_CASE_SET_VERSION,
  PHASE2_DEVELOPMENT_CASE_IDS,
  PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
  PHASE2_EVALUATOR_VERSION,
  PHASE2_INPUT_PROJECTION_VERSION,
  PHASE2_ORACLE_VERSION,
  PHASE2_REVIEW_CODES,
  Phase2EvaluationRecordValidationError,
  summarizePhase2CaseResults,
  validatePhase2EvaluationRecord,
} from "../../src/v2/contracts/phase2-evaluation-record-v1.schema.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import { evaluateCoreCandidateSemantics } from "../../src/v2/phase2/core-semantic-evaluator.js";
import { projectPhase2DevelopmentInput } from "../../src/v2/phase2/development-input-snapshot-builder.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const DEVELOPMENT_FIXTURE_URL = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const developmentCases = JSON.parse(
  await readFile(DEVELOPMENT_FIXTURE_URL, "utf8"),
);
const developmentByCaseId = new Map(
  developmentCases.map((developmentCase) => [
    developmentCase.case_id,
    developmentCase,
  ]),
);

function matchingCollection(comparison, values) {
  return {
    comparison,
    exact: true,
    tp: values.length,
    fp: 0,
    fn: 0,
    expected: structuredClone(values),
    actual: structuredClone(values),
  };
}

function matchingScalar(value) {
  return {
    comparison: "scalar",
    exact: true,
    tp: 1,
    fp: 0,
    fn: 0,
    expected: value,
    actual: value,
  };
}

function makeAutomatic() {
  return {
    passed: true,
    dimensions: {
      topics: matchingCollection("set", ["专业与课程"]),
      applicability_value: matchingScalar("applies"),
      profile_field_ids: matchingCollection("set", ["pf-synthetic-course"]),
      actions: matchingCollection("multiset", ["mandatory"]),
      deadlines: matchingCollection("multiset", [
        {
          original_text: "5:00 pm on 20 September 2026",
          role: "submission_deadline",
        },
      ]),
      consequence_level: matchingScalar("high"),
    },
    totals: {
      dimensions_total: 6,
      dimensions_exact: 6,
      tp: 6,
      fp: 0,
      fn: 0,
    },
  };
}

function makeCaseResult(caseId, index) {
  const language = ["en", "zh-Hant", "mixed", "zh-Hans"][index % 4];
  return {
    case_id: caseId,
    language,
    input_projection_version: PHASE2_INPUT_PROJECTION_VERSION,
    oracle_version: PHASE2_ORACLE_VERSION,
    evaluator_version: PHASE2_EVALUATOR_VERSION,
    hashes: {
      model_input_hash: hashCanonicalJson({ caseId, kind: "input" }),
      oracle_hash: hashCanonicalJson({ caseId, kind: "oracle" }),
      candidate_hash_before: hashCanonicalJson({ caseId, kind: "candidate" }),
      candidate_hash_after: hashCanonicalJson({ caseId, kind: "candidate" }),
    },
    technical_validation: {
      candidate_schema_valid: true,
      references_closed: true,
      quote_unique: true,
      profile_refs_allowed: true,
      forbidden_fields_absent: true,
      candidate_unchanged: true,
    },
    automatic: makeAutomatic(),
    errors: [],
    review_queue: PHASE2_REVIEW_CODES.map((code) => ({
      code,
      path: code === "title_summary" ? "/title_zh" : `/${code}`,
      status: "pending",
      instruction: `Review the synthetic ${code} semantic item.`,
    })),
    excluded_fields: [
      {
        path: "/event_dates",
        reason_code: "core_v2_not_expressible",
        reason: "Generic event dates are outside the frozen Core v2 overlap.",
      },
    ],
  };
}

function summarize(caseResults) {
  const summary = {
    planned_case_count: 16,
    evaluated_case_count: caseResults.length,
    automatic_passed_case_count: 0,
    automatic_failed_case_count: 0,
    technical_invalid_case_count: 0,
    dimension_totals: Object.fromEntries(
      PHASE2_AUTOMATIC_DIMENSION_NAMES.map((name) => [
        name,
        { cases_total: 0, cases_exact: 0, tp: 0, fp: 0, fn: 0 },
      ]),
    ),
    errors: { P0: 0, P1: 0, observation: 0 },
    reviews: { pending: 0, pass: 0, fail: 0 },
    excluded_field_count: 0,
    slices: [],
  };

  for (const result of caseResults) {
    if (result.automatic.passed) summary.automatic_passed_case_count += 1;
    else summary.automatic_failed_case_count += 1;
    if (Object.values(result.technical_validation).some((value) => !value)) {
      summary.technical_invalid_case_count += 1;
    }
    for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
      const dimension = result.automatic.dimensions[name];
      const aggregate = summary.dimension_totals[name];
      aggregate.cases_total += 1;
      if (dimension.exact) aggregate.cases_exact += 1;
      aggregate.tp += dimension.tp;
      aggregate.fp += dimension.fp;
      aggregate.fn += dimension.fn;
    }
    for (const error of result.errors) summary.errors[error.severity] += 1;
    for (const review of result.review_queue) summary.reviews[review.status] += 1;
    summary.excluded_field_count += result.excluded_fields.length;
  }
  return summary;
}

export function makePhase2EvaluationRecord(overrides = {}) {
  const caseResults = PHASE2_DEVELOPMENT_CASE_IDS.map(makeCaseResult);
  const record = {
    record_schema_version: PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
    run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    phase: "phase2a",
    execution_mode: "offline_reference",
    status: "succeeded",
    started_at: "2026-08-31T08:00:00.000Z",
    finished_at: "2026-08-31T08:00:01.000Z",
    provider: "offline_reference",
    model: null,
    prompt_version: "offline_reference",
    safety: {
      provider_requests: 0,
      network_connections: 0,
      locked_file_accesses: 0,
      secret_reads: 0,
      listening_ports: 0,
      real_data_records: 0,
    },
    safety_assurance: structuredClone(PHASE2A_SAFETY_ASSURANCE),
    evaluation: {
      dataset_split: "development",
      case_set_version: PHASE2_CASE_SET_VERSION,
      case_ids: [...PHASE2_DEVELOPMENT_CASE_IDS],
      input_projection_version: PHASE2_INPUT_PROJECTION_VERSION,
      oracle_version: PHASE2_ORACLE_VERSION,
      evaluator_version: PHASE2_EVALUATOR_VERSION,
      candidate_schema_version: PHASE2_CANDIDATE_SCHEMA_VERSION,
      candidate_schema_hash: PHASE2_CANDIDATE_SCHEMA_HASH,
      case_results: caseResults,
      summary: summarize(caseResults),
      claims: structuredClone(PHASE2A_SUCCESS_CLAIMS),
    },
    canonical_evaluation_hash: "",
    error: null,
    ...overrides,
  };
  record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
  return record;
}

test("Phase 2 record accepts a complete 16-case offline reference summary", () => {
  const record = makePhase2EvaluationRecord();
  const result = validatePhase2EvaluationRecord(record);

  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.strictEqual(assertValidPhase2EvaluationRecord(record), record);
  assert.equal(record.evaluation.case_results.length, 16);
  assert.equal(record.evaluation.summary.automatic_passed_case_count, 16);
  assert.equal(record.evaluation.summary.reviews.pending, 80);
  assert.equal(record.evaluation.summary.excluded_field_count, 16);
});

test("Phase 2 record accepts the actual Oracle and Evaluator output for 16/16 cases", () => {
  const record = makePhase2EvaluationRecord();
  record.evaluation.case_results = PHASE2_DEVELOPMENT_CASE_IDS.map((caseId) => {
    const developmentCase = developmentByCaseId.get(caseId);
    const modelInput = projectPhase2DevelopmentInput(developmentCase);
    const oracle = projectCoreOverlapOracle(developmentCase);
    const candidate = buildReferenceCoreCandidateForEvaluation(
      developmentCase,
      oracle,
    );
    const evaluation = evaluateCoreCandidateSemantics({
      oracle,
      candidate,
      modelInput,
    });
    const candidateHash = hashCanonicalJson(candidate);
    return {
      case_id: evaluation.case_id,
      language: modelInput.message.language,
      input_projection_version: PHASE2_INPUT_PROJECTION_VERSION,
      oracle_version: oracle.oracle_version,
      evaluator_version: evaluation.evaluator_version,
      hashes: {
        model_input_hash: hashCanonicalJson(modelInput),
        oracle_hash: hashCanonicalJson(oracle),
        candidate_hash_before: candidateHash,
        candidate_hash_after: candidateHash,
      },
      technical_validation: {
        candidate_schema_valid: true,
        references_closed: true,
        quote_unique: true,
        profile_refs_allowed: true,
        forbidden_fields_absent: true,
        candidate_unchanged: true,
      },
      automatic: evaluation.automatic,
      errors: evaluation.errors,
      review_queue: evaluation.review_queue,
      excluded_fields: evaluation.excluded_fields,
    };
  });
  record.evaluation.summary = summarizePhase2CaseResults(
    record.evaluation.case_results,
  );
  record.canonical_evaluation_hash = computePhase2EvaluationHash(record);

  const result = validatePhase2EvaluationRecord(record);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(record.evaluation.summary.evaluated_case_count, 16);
  assert.equal(record.evaluation.summary.automatic_passed_case_count, 16);
});

test("canonical Evaluation hash covers evaluation only and is key-order stable", () => {
  const record = makePhase2EvaluationRecord();
  const secondRun = structuredClone(record);
  secondRun.run_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  secondRun.started_at = "2026-08-31T09:00:00.000Z";
  secondRun.finished_at = "2026-08-31T09:00:02.000Z";

  assert.equal(
    computePhase2EvaluationHash(secondRun),
    record.canonical_evaluation_hash,
  );

  const reordered = {
    ...record,
    evaluation: {
      claims: record.evaluation.claims,
      summary: record.evaluation.summary,
      case_results: record.evaluation.case_results,
      candidate_schema_version: record.evaluation.candidate_schema_version,
      evaluator_version: record.evaluation.evaluator_version,
      oracle_version: record.evaluation.oracle_version,
      input_projection_version: record.evaluation.input_projection_version,
      candidate_schema_hash: record.evaluation.candidate_schema_hash,
      case_ids: record.evaluation.case_ids,
      case_set_version: record.evaluation.case_set_version,
      dataset_split: record.evaluation.dataset_split,
    },
  };
  assert.equal(
    computePhase2EvaluationHash(reordered),
    record.canonical_evaluation_hash,
  );
});

test("Phase 2 validation is non-mutating", () => {
  const record = makePhase2EvaluationRecord();
  const before = structuredClone(record);
  validatePhase2EvaluationRecord(record);
  assert.deepEqual(record, before);
});

test("Phase 2 record rejects canonical hash and recomputed-score drift", async (t) => {
  await t.test("canonical hash", () => {
    const record = makePhase2EvaluationRecord();
    record.canonical_evaluation_hash = `sha256:${"0".repeat(64)}`;
    assert.equal(validatePhase2EvaluationRecord(record).valid, false);
  });

  await t.test("per-case tp", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.case_results[0].automatic.dimensions.topics.tp = 0;
    record.evaluation.case_results[0].automatic.totals.tp = 5;
    record.evaluation.summary.dimension_totals.topics.tp = 15;
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "recomputedScore"),
      true,
    );
  });

  await t.test("summary", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.summary.excluded_field_count = 15;
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "recomputedSummary"),
      true,
    );
  });
});

test("Phase 2 record rejects false claims, impossible timestamps, and missing diagnostics", async (t) => {
  await t.test("claims beyond the frozen declaration limit", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.claims.can_prove.push(
      "The locked set passed and this product is production ready.",
    );
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    assert.equal(validatePhase2EvaluationRecord(record).valid, false);
  });

  await t.test("calendar-impossible UTC timestamp", () => {
    const record = makePhase2EvaluationRecord();
    record.started_at = "2026-99-99T99:99:99.000Z";
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "strictTimestamp"),
      true,
    );
  });

  await t.test("non-exact automatic dimension without an error ledger entry", () => {
    const record = makePhase2EvaluationRecord();
    record.status = "failed";
    record.evaluation.case_results = record.evaluation.case_results.slice(0, 1);
    const result = record.evaluation.case_results[0];
    result.automatic.dimensions.topics.actual.push("其他校务资讯");
    result.automatic.dimensions.topics.exact = false;
    result.automatic.dimensions.topics.fp = 1;
    result.automatic.passed = false;
    result.automatic.totals.dimensions_exact = 5;
    result.automatic.totals.fp = 1;
    record.evaluation.summary = summarize(record.evaluation.case_results);
    record.evaluation.claims = structuredClone(PHASE2A_FAILURE_CLAIMS);
    record.error = {
      code: "offline_evaluation_failed",
      message: "The offline reference evaluation did not complete.",
    };
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);

    let validation = validatePhase2EvaluationRecord(record);
    assert.equal(validation.valid, false);
    assert.equal(
      validation.errors.some(({ keyword }) => keyword === "diagnosticClosure"),
      true,
    );

    result.errors.push({
      code: "topic_unexpected",
      severity: "P1",
      path: "/topics",
      expected: null,
      actual: "其他校务资讯",
    });
    record.evaluation.summary = summarize(record.evaluation.case_results);
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    validation = validatePhase2EvaluationRecord(record);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  });
});

test("Phase 2 record rejects missing, duplicate, or reordered frozen cases", async (t) => {
  for (const [name, mutate] of [
    ["missing", (record) => record.evaluation.case_results.pop()],
    [
      "duplicate",
      (record) => {
        record.evaluation.case_results[1].case_id =
          record.evaluation.case_results[0].case_id;
      },
    ],
    [
      "reordered",
      (record) => {
        [record.evaluation.case_results[0], record.evaluation.case_results[1]] = [
          record.evaluation.case_results[1],
          record.evaluation.case_results[0],
        ];
      },
    ],
  ]) {
    await t.test(name, () => {
      const record = makePhase2EvaluationRecord();
      mutate(record);
      record.evaluation.summary = summarize(record.evaluation.case_results);
      record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
      assert.equal(validatePhase2EvaluationRecord(record).valid, false);
    });
  }
});

test("Phase 2 record rejects Candidate mutation and incomplete review closure", async (t) => {
  await t.test("Candidate hash mismatch", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.case_results[0].hashes.candidate_hash_after =
      hashCanonicalJson({ changed: true });
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "candidateIntegrity"),
      true,
    );
  });

  await t.test("duplicate manual review", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.case_results[0].review_queue[1].code = "title_summary";
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "reviewClosure"),
      true,
    );
  });

  await t.test("offline reference cannot pre-approve a manual review", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.case_results[0].review_queue[0].status = "pass";
    record.evaluation.summary = summarize(record.evaluation.case_results);
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "phase2aReviewState"),
      true,
    );
  });
});

test("Phase 2 record cannot retain secrets, raw Candidate, or a full Prompt", async (t) => {
  await t.test("secret-like value", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.claims.can_prove[0] =
      "Authorization: Bearer synthetic-secret-value";
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    assert.equal(validatePhase2EvaluationRecord(record).valid, false);
  });

  await t.test("raw Candidate key inside diagnostic value", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.case_results[0].errors.push({
      code: "synthetic_observation",
      severity: "observation",
      path: "/diagnostic",
      expected: null,
      actual: { raw_candidate: { title_zh: "不应保存" } },
    });
    record.evaluation.summary = summarize(record.evaluation.case_results);
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    const result = validatePhase2EvaluationRecord(record);
    assert.equal(result.valid, false);
    assert.equal(
      result.errors.some(({ keyword }) => keyword === "safeRecord"),
      true,
    );
  });

  await t.test("full Prompt key inside diagnostic value", () => {
    const record = makePhase2EvaluationRecord();
    record.evaluation.case_results[0].errors.push({
      code: "synthetic_observation",
      severity: "observation",
      path: "/diagnostic",
      expected: null,
      actual: { full_prompt: "Do not persist this content." },
    });
    record.evaluation.summary = summarize(record.evaluation.case_results);
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
    assert.equal(validatePhase2EvaluationRecord(record).valid, false);
  });
});

test("Phase 2 record supports a redacted terminal failure with partial results", () => {
  const record = makePhase2EvaluationRecord();
  record.status = "failed";
  record.evaluation.case_results = record.evaluation.case_results.slice(0, 1);
  record.evaluation.summary = summarize(record.evaluation.case_results);
  record.evaluation.claims = structuredClone(PHASE2A_FAILURE_CLAIMS);
  record.error = {
    code: "offline_evaluation_failed",
    message: "The offline reference evaluation did not complete.",
  };
  record.canonical_evaluation_hash = computePhase2EvaluationHash(record);

  const result = validatePhase2EvaluationRecord(record);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test("Phase 2 assert exposes a controlled writer-facing validation error", () => {
  const record = makePhase2EvaluationRecord();
  record.safety.provider_requests = 1;
  assert.throws(
    () => assertValidPhase2EvaluationRecord(record),
    (error) =>
      error instanceof Phase2EvaluationRecordValidationError &&
      error.code === "record_write_failed" &&
      error.validationErrors.length > 0,
  );
});
