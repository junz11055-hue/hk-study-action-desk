import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidPhase1CoreRunRecord,
  Phase1CoreRunRecordValidationError,
  validatePhase1CoreRunRecord,
} from "../../src/v2/contracts/phase1-core-run-record-v2.schema.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  makeCoreAttempt,
  makeCoreFailureRecord,
  makeCoreSuccessRecord,
} from "./phase1-core-run-record-fixtures.js";

function rehashCandidate(record) {
  const hash = hashCanonicalJson(record.candidate);
  record.hashes.candidate_hash = hash;
  record.hashes.delivered_output_hash = hash;
}

test("Core Run Record v2 accepts complete success and redacted failure records", () => {
  const success = makeCoreSuccessRecord();
  const failure = makeCoreFailureRecord();
  assert.equal(validatePhase1CoreRunRecord(success).valid, true);
  assert.equal(validatePhase1CoreRunRecord(failure).valid, true);
  assert.strictEqual(assertValidPhase1CoreRunRecord(success), success);
});

test("Core Run Record freezes every DeepSeek execution prerequisite", async (t) => {
  const deepseekSuccess = () =>
    makeCoreSuccessRecord({
      execution_mode: "deepseek",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      provider_endpoint: "https://api.deepseek.com",
      implementation_commit_sha: "a".repeat(40),
      implementation_git_clean: true,
      attempts: [makeCoreAttempt({ http_status: 200 })],
    });
  assert.equal(validatePhase1CoreRunRecord(deepseekSuccess()).valid, true);

  for (const [name, mutate] of [
    ["model", (record) => { record.model = "deepseek-v4-pro"; }],
    ["endpoint", (record) => { record.provider_endpoint = "https://example.invalid"; }],
    ["commit", (record) => { record.implementation_commit_sha = null; }],
    ["clean tree", (record) => { record.implementation_git_clean = false; }],
    ["HTTP success", (record) => { record.attempts[0].http_status = null; }],
  ]) {
    await t.test(name, () => {
      const record = deepseekSuccess();
      mutate(record);
      assert.equal(validatePhase1CoreRunRecord(record).valid, false);
    });
  }
});

test("Core Run Record validation never mutates the supplied record", () => {
  const record = makeCoreSuccessRecord();
  const before = structuredClone(record);
  validatePhase1CoreRunRecord(record);
  assert.deepEqual(record, before);
});

test("Core Run Record binds the single payload and unchanged Candidate hashes", async (t) => {
  await t.test("payload hash", () => {
    const record = makeCoreSuccessRecord();
    record.hashes.model_payload_hash = `sha256:${"a".repeat(64)}`;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("candidate hash", () => {
    const record = makeCoreSuccessRecord();
    record.candidate.title_zh = "changed";
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("delivery hash", () => {
    const record = makeCoreSuccessRecord();
    record.hashes.delivered_output_hash = `sha256:${"b".repeat(64)}`;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
});

test("Core Run Record rejects inconsistent or unsafe partial-output diagnostics", async (t) => {
  await t.test("present without hash", () => {
    const record = makeCoreFailureRecord();
    record.attempts[0].partial_output_hash = null;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("absent with bytes", () => {
    const record = makeCoreFailureRecord();
    record.attempts[0].partial_output_present = false;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("item count mismatch", () => {
    const record = makeCoreFailureRecord();
    record.attempts[0].output_item_count = 1;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("raw response field", () => {
    const record = makeCoreFailureRecord();
    record.attempts[0].raw_response = "must never be stored";
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("partial text field", () => {
    const record = makeCoreFailureRecord();
    record.attempts[0].partial_output_text = "must never be stored";
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
});

test("Core Run Record freezes one attempt, 8000 tokens, and 90000 ms", async (t) => {
  await t.test("two attempts", () => {
    const record = makeCoreFailureRecord();
    record.attempts.push(structuredClone(record.attempts[0]));
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("token drift", () => {
    const record = makeCoreSuccessRecord();
    record.decoding.max_output_tokens = 6000;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
  await t.test("timeout drift", () => {
    const record = makeCoreSuccessRecord();
    record.decoding.timeout_ms = 89999;
    assert.equal(validatePhase1CoreRunRecord(record).valid, false);
  });
});

test("Core Run Record supports a controlled failure before provider transport", () => {
  const record = makeCoreFailureRecord({
    attempt_budget_exhausted: false,
    attempts: [],
    hashes: {
      ...makeCoreFailureRecord().hashes,
      model_payload_hash: null,
      blocked_payload_hash: makeCoreFailureRecord().hashes.model_payload_hash,
    },
    error: {
      code: "duplicate_payload_blocked",
      message: "A repeated content-failure payload was blocked.",
    },
  });
  assert.equal(validatePhase1CoreRunRecord(record).valid, true);
});

test("Core Run Record throws a controlled write error contract", () => {
  const record = makeCoreSuccessRecord();
  record.decoding.max_attempts = 2;
  assert.throws(
    () => assertValidPhase1CoreRunRecord(record),
    (error) =>
      error instanceof Phase1CoreRunRecordValidationError &&
      error.code === "record_write_failed" &&
      error.validationErrors.length > 0,
  );
});

test("Core Run Record accepts a provider-completed Harness failure without erasing the attempt", () => {
  const record = makeCoreFailureRecord({
    attempts: [
      makeCoreAttempt({
        outcome: "harness_error",
        provider_status: "completed",
        error_code: "internal_error",
      }),
    ],
    error: {
      code: "internal_error",
      message: "The Core v2 run failed internally.",
    },
  });
  assert.equal(validatePhase1CoreRunRecord(record).valid, true);
});

test("Core Run Record independently rejects reference, evidence, profile, status, and secret drift", async (t) => {
  const cases = [
    ["dangling Candidate reference", () => {
      const record = makeCoreSuccessRecord();
      record.candidate.title_claim_refs = ["missing-claim"];
      rehashCandidate(record);
      return record;
    }],
    ["zero-width evidence locator", () => {
      const record = makeCoreSuccessRecord();
      record.validation_evidence.evidence_locators[0].start = 10;
      record.validation_evidence.evidence_locators[0].end = 10;
      return record;
    }],
    ["wrong evidence locator identity", () => {
      const record = makeCoreSuccessRecord();
      record.validation_evidence.evidence_locators[0].evidence_id = "wrong-id";
      return record;
    }],
    ["wrong profile identity", () => {
      const record = makeCoreSuccessRecord();
      record.validation_evidence.profile_refs[0].profile_field_id = "pf-other";
      return record;
    }],
    ["unconfirmed profile", () => {
      const record = makeCoreSuccessRecord();
      record.validation_evidence.profile_refs[0].confirmation_status = "candidate";
      return record;
    }],
    ["wrong profile date", () => {
      const record = makeCoreSuccessRecord();
      record.validation_evidence.profile_refs[0].valid_until = "2026-12-30";
      return record;
    }],
    ["wrong profile source", () => {
      const record = makeCoreSuccessRecord();
      record.validation_evidence.profile_refs[0].source = "user_imported";
      return record;
    }],
    ["success with blocked hash", () => {
      const record = makeCoreSuccessRecord();
      record.hashes.blocked_payload_hash = `sha256:${"a".repeat(64)}`;
      return record;
    }],
    ["timeout outcome with completed provider", () => {
      const record = makeCoreFailureRecord();
      Object.assign(record.attempts[0], {
        outcome: "timeout",
        provider_status: "completed",
        incomplete_reason: null,
        partial_output_present: false,
        partial_output_bytes: 0,
        partial_output_hash: null,
        error_code: "model_timeout",
      });
      record.error = {
        code: "model_timeout",
        message: "The model request timed out.",
      };
      return record;
    }],
    ["incomplete provider without reason", () => {
      const record = makeCoreFailureRecord();
      record.attempts[0].incomplete_reason = null;
      return record;
    }],
    ["failure claiming every validation flag", () => {
      const record = makeCoreFailureRecord();
      for (const key of Object.keys(record.validation)) record.validation[key] = true;
      return record;
    }],
    ["secret-like error message", () => {
      const record = makeCoreFailureRecord();
      record.error.message = "Authorization: Bearer synthetic-secret-token";
      return record;
    }],
    ["error code and outcome mismatch", () => {
      const record = makeCoreFailureRecord();
      record.attempts[0].error_code = "model_timeout";
      record.error = {
        code: "model_timeout",
        message: "The model request timed out.",
      };
      return record;
    }],
    ["attempt outside root time envelope", () => {
      const record = makeCoreSuccessRecord();
      record.attempts[0].started_at = "2026-08-30T23:59:59.999Z";
      return record;
    }],
    ["successful Candidate with English Chinese-owned field", () => {
      const record = makeCoreSuccessRecord();
      record.candidate.title_zh = "Assignment deadline";
      rehashCandidate(record);
      return record;
    }],
  ];

  for (const [name, makeRecord] of cases) {
    await t.test(name, () => {
      assert.equal(validatePhase1CoreRunRecord(makeRecord()).valid, false);
    });
  }
});
