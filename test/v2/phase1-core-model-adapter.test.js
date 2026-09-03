import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStructuredRequestBody,
  ModelRequestError,
} from "../../src/agent/deepseek-responses-client.js";
import {
  CORE_CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  analyzePhase1CoreCandidate,
  CoreContentPayloadGuard,
  PHASE1_CORE_MAX_OUTPUT_TOKENS,
  Phase1CoreModelAdapterError,
} from "../../src/v2/model/phase1-core-model-adapter.js";
import { NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2 } from "../../src/v2/prompts/notification-analysis-core-p1-v2.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../../src/v2/validation/canonical-json.js";
import { makeCoreCandidate, makeCoreModelInput } from "./core-test-fixtures.js";

const FIXED_TIME = "2026-08-31T00:00:00.000Z";

function successMetadata() {
  return {
    startedAt: FIXED_TIME,
    finishedAt: FIXED_TIME,
    durationMs: 0,
    httpStatus: null,
    providerStatus: "completed",
    incompleteReason: null,
    outputItemTypes: ["message"],
    outputItemCount: 1,
    partialVisibleOutputPresent: false,
    partialVisibleOutputUtf8Bytes: 0,
    partialVisibleOutputSha256: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    outputTextTokens: null,
    maxOutputTokens: 8_000,
  };
}

function mockClient(handler, overrides = {}) {
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt(request) {
      calls += 1;
      return await handler(request, calls);
    },
    ...overrides,
  };
  return { client, calls: () => calls };
}

test("Core adapter completes one unchanged 8000-token mock attempt", async () => {
  const candidate = makeCoreCandidate();
  let captured;
  const fake = mockClient(async (request) => {
    captured = request;
    return { value: candidate, metadata: successMetadata() };
  });

  const result = await analyzePhase1CoreCandidate({
    executionMode: "mock",
    modelClient: fake.client,
    modelInput: makeCoreModelInput(),
    clock: () => new Date(FIXED_TIME),
  });

  assert.equal(fake.calls(), 1);
  assert.equal(captured.maxOutputTokens, 8_000);
  assert.strictEqual(result.candidate, candidate);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].outcome, "completed");
  assert.equal(result.attempts[0].max_output_tokens, 8_000);
  assert.equal(result.validation.candidate_unchanged, true);
  assert.equal(result.validation.quote_unique, true);
  assert.equal(result.attemptBudgetExhausted, false);
  assert.equal(result.validationEvidence.body_evidence_locations.length, 3);
  assert.equal(result.validationEvidence.profile_ref_matches.length, 1);
});

test("Core request and every approved component stay inside byte budgets", () => {
  const modelInput = makeCoreModelInput();
  const serializedInput = canonicalJsonStringify(modelInput);
  const requestBody = buildStructuredRequestBody({
    model: "deepseek-v4-flash",
    instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
    input: serializedInput,
    schema: NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
    schemaName: CORE_CANDIDATE_SCHEMA_NAME,
    maxOutputTokens: PHASE1_CORE_MAX_OUTPUT_TOKENS,
  });

  assert.ok(
    Buffer.byteLength(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2, "utf8") <= 2_000,
  );
  assert.ok(
    Buffer.byteLength(
      JSON.stringify(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
      "utf8",
    ) <= 6_000,
  );
  assert.ok(Buffer.byteLength(serializedInput, "utf8") <= 2_200);
  assert.ok(Buffer.byteLength(JSON.stringify(requestBody), "utf8") <= 10_000);
  assert.ok(Buffer.byteLength(JSON.stringify(makeCoreCandidate()), "utf8") <= 3_000);
  assert.equal(requestBody.max_output_tokens, 8_000);
  assert.equal(requestBody.store, false);
  assert.equal("tools" in requestBody, false);
});

test("Core adapter records redacted truncation diagnostics and never retries", async () => {
  const partialHash = `sha256:${"1".repeat(64)}`;
  const fake = mockClient(async () => {
    const error = new ModelRequestError("safe incomplete", {
      code: "model_response_invalid",
      outcome: "truncated",
      retryable: true,
      increaseOutputBudget: true,
    });
    error.attemptMetadata = {
      ...successMetadata(),
      httpStatus: 200,
      providerStatus: "incomplete",
      incompleteReason: "max_output_tokens",
      outputItemTypes: ["reasoning", "message"],
      outputItemCount: 2,
      partialVisibleOutputPresent: true,
      partialVisibleOutputUtf8Bytes: 27,
      partialVisibleOutputSha256: partialHash,
      inputTokens: 500,
      outputTokens: 8_000,
      reasoningTokens: 7_900,
      outputTextTokens: 100,
    };
    throw error;
  });

  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.ok(error instanceof Phase1CoreModelAdapterError);
      assert.equal(error.code, "model_response_invalid");
      assert.equal(error.attempts.length, 1);
      assert.deepEqual(error.attempts[0], {
        attempt: 1,
        started_at: FIXED_TIME,
        finished_at: FIXED_TIME,
        outcome: "truncated",
        http_status: 200,
        input_tokens: 500,
        output_tokens: 8_000,
        reasoning_tokens: 7_900,
        output_text_tokens: 100,
        duration_ms: 0,
        max_output_tokens: 8_000,
        prompt_hash: error.attempts[0].prompt_hash,
        request_payload_hash: error.attempts[0].request_payload_hash,
        provider_status: "incomplete",
        incomplete_reason: "max_output_tokens",
        output_item_types: ["reasoning", "message"],
        output_item_count: 2,
        partial_output_present: true,
        partial_output_bytes: 27,
        partial_output_hash: partialHash,
        error_code: "model_response_invalid",
      });
      assert.doesNotMatch(JSON.stringify(error), /partial text|raw_response/iu);
      return true;
    },
  );
  assert.equal(fake.calls(), 1);
});

test("Core adapter stops after one refusal, invalid JSON, or invalid Candidate", async (t) => {
  await t.test("refusal", async () => {
    const fake = mockClient(async () => {
      const error = new ModelRequestError("safe refusal", {
        code: "model_refused",
        outcome: "refused",
      });
      error.attemptMetadata = {
        ...successMetadata(),
        providerStatus: "refused",
      };
      throw error;
    });
    await assert.rejects(
      analyzePhase1CoreCandidate({
        executionMode: "mock",
        modelClient: fake.client,
        modelInput: makeCoreModelInput(),
      }),
      { code: "model_refused" },
    );
    assert.equal(fake.calls(), 1);
  });

  await t.test("invalid JSON", async () => {
    const fake = mockClient(async () => {
      throw new ModelRequestError("safe invalid JSON", {
        code: "model_response_invalid",
        outcome: "invalid_json",
      });
    });
    await assert.rejects(
      analyzePhase1CoreCandidate({
        executionMode: "mock",
        modelClient: fake.client,
        modelInput: makeCoreModelInput(),
      }),
      { code: "model_response_invalid" },
    );
    assert.equal(fake.calls(), 1);
  });

  await t.test("invalid Candidate", async () => {
    const fake = mockClient(async () => {
      const candidate = makeCoreCandidate();
      delete candidate.summary_zh;
      return { value: candidate, metadata: successMetadata() };
    });
    await assert.rejects(
      analyzePhase1CoreCandidate({
        executionMode: "mock",
        modelClient: fake.client,
        modelInput: makeCoreModelInput(),
      }),
      { code: "candidate_schema_invalid" },
    );
    assert.equal(fake.calls(), 1);
  });

  await t.test("non-JSON Candidate", async () => {
    const fake = mockClient(async () => ({
      value: undefined,
      metadata: successMetadata(),
    }));
    await assert.rejects(
      analyzePhase1CoreCandidate({
        executionMode: "mock",
        modelClient: fake.client,
        modelInput: makeCoreModelInput(),
      }),
      (error) =>
        error.code === "candidate_schema_invalid" &&
        error.candidateHash === null &&
        error.attempts.length === 1 &&
        error.attempts[0].outcome === "candidate_invalid",
    );
    assert.equal(fake.calls(), 1);
  });
});

test("Core failure flags never claim unchecked references are closed", async () => {
  const fake = mockClient(async () => {
    const candidate = makeCoreCandidate();
    candidate.evidence[0].quote = "not present in the message body";
    candidate.actions[0].claim_refs = ["missing-later-claim"];
    return { value: candidate, metadata: successMetadata() };
  });

  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.equal(error.code, "candidate_evidence_invalid");
      assert.equal(error.validation.schema_valid, true);
      assert.equal(error.validation.references_closed, false);
      assert.equal(error.validation.quote_unique, false);
      return true;
    },
  );
  assert.equal(fake.calls(), 1);
});

test("Core payload guard blocks a repeated content-failure hash before transport", async () => {
  const guard = new CoreContentPayloadGuard();
  const fake = mockClient(async () => {
    throw new ModelRequestError("safe invalid JSON", {
      code: "model_response_invalid",
      outcome: "invalid_json",
    });
  });
  const options = {
    executionMode: "mock",
    modelClient: fake.client,
    modelInput: makeCoreModelInput(),
    payloadGuard: guard,
  };

  await assert.rejects(analyzePhase1CoreCandidate(options), {
    code: "model_response_invalid",
  });
  assert.equal(fake.calls(), 1);
  await assert.rejects(analyzePhase1CoreCandidate(options), (error) => {
    assert.equal(error.code, "duplicate_payload_blocked");
    assert.equal(error.attempts.length, 0);
    assert.match(error.blockedPayloadHash, /^sha256:[0-9a-f]{64}$/u);
    return true;
  });
  assert.equal(fake.calls(), 1);
});

test("Core adapter rejects missing configuration before transport", async () => {
  const fake = mockClient(async () => {
    throw new Error("must not run");
  });
  fake.client.configured = false;
  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
    }),
    { code: "model_not_configured" },
  );
  assert.equal(fake.calls(), 0);
});

test("Core adapter rejects malformed Model Input before any provider attempt", async (t) => {
  const cases = [
    ["extra field", (value) => { value.repair_feedback = null; }],
    ["oversized profile value", (value) => { value.profile_refs[0].value = "x".repeat(201); }],
    ["unsafe URL", (value) => { value.message.body = value.message.body.replace("https://", "http://"); }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const fake = mockClient(async () => {
        throw new Error("provider must not be called");
      });
      const modelInput = makeCoreModelInput();
      mutate(modelInput);
      await assert.rejects(
        analyzePhase1CoreCandidate({
          executionMode: "mock",
          modelClient: fake.client,
          modelInput,
        }),
        (error) =>
          error instanceof Phase1CoreModelAdapterError &&
          error.code === "fixture_invalid" &&
          error.attempts.length === 0,
      );
      assert.equal(fake.calls(), 0);
    });
  }
});

test("Core adapter records a non-Chinese Candidate as one content failure", async () => {
  const fake = mockClient(async () => {
    const candidate = makeCoreCandidate();
    candidate.summary_zh = "Submit Assignment 1 before the deadline.";
    return { value: candidate, metadata: successMetadata() };
  });

  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.equal(error.code, "candidate_language_invalid");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].outcome, "candidate_invalid");
      assert.equal(error.validation.schema_valid, true);
      assert.equal(error.validation.candidate_unchanged, false);
      return true;
    },
  );
  assert.equal(fake.calls(), 1);
});

test("Core adapter never upgrades missing DeepSeek completion metadata", async () => {
  const fake = mockClient(
    async () => ({
      value: makeCoreCandidate(),
      metadata: {
        ...successMetadata(),
        providerStatus: null,
        httpStatus: 200,
      },
    }),
    {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    },
  );

  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "deepseek",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.equal(error.code, "model_response_invalid");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].provider_status, null);
      assert.equal(error.attempts[0].outcome, "permanent_error");
      return true;
    },
  );
  assert.equal(fake.calls(), 1);
});

test("Core adapter records the real attempt if a validator mutates or replaces Candidate", async () => {
  const fake = mockClient(async () => ({
    value: makeCoreCandidate(),
    metadata: successMetadata(),
  }));
  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      validateCandidate(candidate) {
        candidate.title_zh = "mutated";
        return candidate;
      },
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.equal(error.code, "internal_error");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].outcome, "candidate_invalid");
      assert.equal(error.attemptBudgetExhausted, true);
      return true;
    },
  );
  assert.equal(fake.calls(), 1);
});

test("Core adapter fails closed if client request metadata drifts from the local payload", async () => {
  const fake = mockClient(async () => ({
    value: makeCoreCandidate(),
    metadata: {
      ...successMetadata(),
      requestBody: { drifted: true },
    },
  }));
  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.equal(error.code, "internal_error");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].outcome, "harness_error");
      assert.match(error.attempts[0].request_payload_hash, /^sha256:[0-9a-f]{64}$/u);
      assert.notEqual(
        error.attempts[0].request_payload_hash,
        hashCanonicalJson({ drifted: true }),
      );
      return true;
    },
  );
});

test("Core adapter converts completed-but-malformed diagnostics into a safe Harness failure", async () => {
  const fake = mockClient(async () => ({
    value: makeCoreCandidate(),
    metadata: {
      ...successMetadata(),
      outputItemCount: 2_000,
    },
  }));

  await assert.rejects(
    analyzePhase1CoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      modelInput: makeCoreModelInput(),
      clock: () => new Date(FIXED_TIME),
    }),
    (error) => {
      assert.equal(error.code, "internal_error");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].outcome, "harness_error");
      assert.equal(error.attempts[0].provider_status, "completed");
      assert.equal(error.attempts[0].output_item_count, 1);
      assert.equal(error.attempts[0].error_code, "internal_error");
      return true;
    },
  );
  assert.equal(fake.calls(), 1);
});

test("Core adapter bounds parseable metadata timestamps to its local attempt envelope", async () => {
  const fake = mockClient(async () => ({
    value: makeCoreCandidate(),
    metadata: {
      ...successMetadata(),
      startedAt: "2026-08-30T23:59:59.000Z",
      finishedAt: "2026-09-01T00:00:01.000Z",
    },
  }));

  const result = await analyzePhase1CoreCandidate({
    executionMode: "mock",
    modelClient: fake.client,
    modelInput: makeCoreModelInput(),
    clock: () => new Date(FIXED_TIME),
  });

  assert.equal(result.attempts[0].started_at, FIXED_TIME);
  assert.equal(result.attempts[0].finished_at, FIXED_TIME);
  assert.equal(result.attempts[0].duration_ms, 0);
});
