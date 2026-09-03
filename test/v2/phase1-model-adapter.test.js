import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStructuredRequestBody,
  ModelRequestError,
} from "../../src/agent/deepseek-responses-client.js";
import {
  CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-candidate-p1.schema.js";
import { loadDevelopmentFixture } from "../../src/v2/fixtures/development-fixture-loader.js";
import {
  analyzePhase1Candidate,
  createDev001MockCandidate,
  createPhase1MockModelClient,
  Phase1ModelAdapterError,
} from "../../src/v2/model/phase1-model-adapter.js";
import { NOTIFICATION_ANALYSIS_PROMPT_P1 } from "../../src/v2/prompts/notification-analysis-prompt-p1.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { CandidateValidationError } from "../../src/v2/validation/candidate-validator.js";

async function dev001Input() {
  return (await loadDevelopmentFixture({ caseId: "DEV001" })).modelInput;
}

function scriptedClient(script, requests = []) {
  let index = 0;
  return {
    configured: true,
    provider: "mock",
    model: "phase1-offline-mock",
    async createStructuredAttempt(request) {
      requests.push(request);
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      return await step(request, index);
    },
  };
}

test("offline mock carries only the projected input through one unchanged Candidate", async () => {
  const modelInput = await dev001Input();
  const captured = [];
  const client = createPhase1MockModelClient({
    candidateFactory(input, request) {
      captured.push({ input, request });
      return createDev001MockCandidate(input);
    },
  });

  const result = await analyzePhase1Candidate({
    executionMode: "mock",
    modelClient: client,
    modelInput,
    sleepImpl: async () => {},
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].input.repair_feedback, null);
  assert.equal(JSON.stringify(captured[0].input).includes('"expected"'), false);
  assert.equal(captured[0].request.instructions, NOTIFICATION_ANALYSIS_PROMPT_P1);
  assert.equal(captured[0].request.schema, NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA);
  assert.equal(captured[0].request.schemaName, CANDIDATE_SCHEMA_NAME);
  assert.equal(captured[0].request.maxOutputTokens, 6_000);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].outcome, "completed");
  assert.equal(result.attempts[0].retry_kind, "initial");
  assert.deepEqual(result.validation, {
    schema_valid: true,
    references_closed: true,
    locator_quotes_exact: true,
    forbidden_fields_absent: true,
    candidate_unchanged: true,
  });
  assert.equal(result.candidateHash, hashCanonicalJson(result.candidate));

  const expectedBody = buildStructuredRequestBody({
    model: "phase1-offline-mock",
    instructions: NOTIFICATION_ANALYSIS_PROMPT_P1,
    input: captured[0].request.input,
    schema: NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
    schemaName: CANDIDATE_SCHEMA_NAME,
    maxOutputTokens: 6_000,
  });
  assert.equal(result.attempts[0].request_payload_hash, hashCanonicalJson(expectedBody));
});

test("transport and Candidate repair share one three-attempt budget without changing instructions", async () => {
  const modelInput = await dev001Input();
  const requests = [];
  const timeout = () => {
    throw new ModelRequestError("timeout", {
      retryable: true,
      code: "model_timeout",
      outcome: "timeout",
    });
  };
  const client = scriptedClient(
    [
      timeout,
      async () => ({ value: {}, metadata: null }),
      async (request) => ({
        value: createDev001MockCandidate(JSON.parse(request.input)),
        metadata: null,
      }),
    ],
    requests,
  );

  const result = await analyzePhase1Candidate({
    executionMode: "mock",
    modelClient: client,
    modelInput,
    sleepImpl: async () => {},
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.retry_kind),
    ["initial", "transport", "candidate_repair"],
  );
  assert.deepEqual(
    result.attempts.map((attempt) => attempt.outcome),
    ["timeout", "candidate_invalid", "completed"],
  );
  assert.ok(requests.every((request) => request.instructions === NOTIFICATION_ANALYSIS_PROMPT_P1));
  assert.equal(JSON.parse(requests[0].input).repair_feedback, null);
  assert.equal(JSON.parse(requests[1].input).repair_feedback, null);
  assert.deepEqual(JSON.parse(requests[2].input).repair_feedback, {
    error_code: "candidate_schema_invalid",
    json_paths: ["/"],
    message: "The candidate did not match the approved schema.",
  });
});

test("only explicit truncation raises the following attempt from 6000 to 8000", async () => {
  const modelInput = await dev001Input();
  const requests = [];
  const client = scriptedClient(
    [
      async () => {
        throw new ModelRequestError("truncated", {
          retryable: true,
          repairable: true,
          increaseOutputBudget: true,
          code: "model_response_invalid",
          outcome: "truncated",
        });
      },
      async (request) => ({
        value: createDev001MockCandidate(JSON.parse(request.input)),
        metadata: null,
      }),
    ],
    requests,
  );

  const result = await analyzePhase1Candidate({
    executionMode: "mock",
    modelClient: client,
    modelInput,
    sleepImpl: async () => {},
  });

  assert.deepEqual(requests.map((request) => request.maxOutputTokens), [6_000, 8_000]);
  assert.deepEqual(
    result.attempts.map((attempt) => [attempt.retry_kind, attempt.max_output_tokens]),
    [
      ["initial", 6_000],
      ["truncation", 8_000],
    ],
  );
  assert.equal(JSON.parse(requests[1].input).repair_feedback, null);
});

test("three provider failures exhaust exactly one attempt budget and preserve the root cause", async () => {
  const modelInput = await dev001Input();
  let calls = 0;
  const client = scriptedClient([
    async () => {
      calls += 1;
      throw new ModelRequestError("timeout", {
        retryable: true,
        code: "model_timeout",
        outcome: "timeout",
      });
    },
  ]);

  await assert.rejects(
    analyzePhase1Candidate({
      executionMode: "mock",
      modelClient: client,
      modelInput,
      sleepImpl: async () => {},
    }),
    (error) =>
      error instanceof Phase1ModelAdapterError &&
      error.code === "model_timeout" &&
      error.attempts.length === 3 &&
      error.attemptBudgetExhausted === true,
  );
  assert.equal(calls, 3);
});

test("Harness fields and forbidden-action errors stop immediately without repair", async (t) => {
  const modelInput = await dev001Input();

  await t.test("recursive Harness field", async () => {
    let calls = 0;
    const client = scriptedClient([
      async (request) => {
        calls += 1;
        return {
          value: {
            ...createDev001MockCandidate(JSON.parse(request.input)),
            home_section: "to_do",
          },
          metadata: null,
        };
      },
    ]);

    await assert.rejects(
      analyzePhase1Candidate({ executionMode: "mock", modelClient: client, modelInput }),
      (error) =>
        error instanceof Phase1ModelAdapterError &&
        error.code === "candidate_forbidden_field" &&
        error.attempts.length === 1 &&
        error.attemptBudgetExhausted === false,
    );
    assert.equal(calls, 1);
  });

  await t.test("validator forbidden-action alias", async () => {
    let calls = 0;
    const client = scriptedClient([
      async (request) => {
        calls += 1;
        return {
          value: createDev001MockCandidate(JSON.parse(request.input)),
          metadata: null,
        };
      },
    ]);
    const validateCandidate = () => {
      throw new CandidateValidationError(
        "candidate_forbidden_action",
        "controlled",
        ["$.actions"],
      );
    };

    await assert.rejects(
      analyzePhase1Candidate({
        executionMode: "mock",
        modelClient: client,
        modelInput,
        validateCandidate,
      }),
      (error) =>
        error.code === "candidate_forbidden_field" &&
        error.attempts.length === 1,
    );
    assert.equal(calls, 1);
  });
});

test("execution mode cannot substitute a mock client for DeepSeek", async () => {
  const modelInput = await dev001Input();
  await assert.rejects(
    analyzePhase1Candidate({
      executionMode: "deepseek",
      modelClient: createPhase1MockModelClient(),
      modelInput,
    }),
    (error) => error instanceof Phase1ModelAdapterError && error.code === "internal_error",
  );
});

test("DeepSeek mode uses the same one-attempt contract under an offline transport double", async () => {
  const modelInput = await dev001Input();
  const requests = [];
  const modelClient = {
    configured: true,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    async createStructuredAttempt(request) {
      requests.push(request);
      return {
        value: createDev001MockCandidate(JSON.parse(request.input)),
        metadata: null,
      };
    },
  };

  const result = await analyzePhase1Candidate({
    executionMode: "deepseek",
    modelClient,
    modelInput,
  });

  assert.equal(requests.length, 1);
  assert.equal(result.attempts.length, 1);
  const expectedBody = buildStructuredRequestBody({
    model: "deepseek-v4-flash",
    instructions: requests[0].instructions,
    input: requests[0].input,
    schema: requests[0].schema,
    schemaName: requests[0].schemaName,
    maxOutputTokens: requests[0].maxOutputTokens,
  });
  assert.equal(result.attempts[0].request_payload_hash, hashCanonicalJson(expectedBody));
});

test("429, 408, 409 and 5xx transport outcomes retry inside the same adapter budget", async (t) => {
  const modelInput = await dev001Input();
  const cases = [
    {
      label: "429",
      error: new ModelRequestError("rate limited", {
        status: 429,
        retryable: true,
        retryAfterMs: 0,
        code: "model_rate_limited",
        outcome: "rate_limited",
      }),
      retryKind: "retry_after",
    },
    ...[408, 409, 500, 503].map((status) => ({
      label: String(status),
      error: new ModelRequestError("transient", {
        status,
        retryable: true,
        code: "model_transport_failed",
        outcome: "transient_error",
      }),
      retryKind: "transport",
    })),
  ];

  for (const scenario of cases) {
    await t.test(scenario.label, async () => {
      let calls = 0;
      const requests = [];
      const client = scriptedClient(
        [
          async () => {
            calls += 1;
            throw scenario.error;
          },
          async (request) => {
            calls += 1;
            return {
              value: createDev001MockCandidate(JSON.parse(request.input)),
              metadata: null,
            };
          },
        ],
        requests,
      );
      const result = await analyzePhase1Candidate({
        executionMode: "mock",
        modelClient: client,
        modelInput,
        sleepImpl: async () => {},
      });
      assert.equal(calls, 2);
      assert.equal(result.attempts.length, 2);
      assert.equal(result.attempts[1].retry_kind, scenario.retryKind);
      assert.equal(JSON.parse(requests[1].input).repair_feedback, null);
    });
  }
});

test("invalid JSON receives bounded feedback while the base instructions remain unchanged", async () => {
  const modelInput = await dev001Input();
  const requests = [];
  const client = scriptedClient(
    [
      async () => {
        throw new ModelRequestError("invalid JSON", {
          repairable: true,
          code: "model_response_invalid",
          outcome: "invalid_json",
        });
      },
      async (request) => ({
        value: createDev001MockCandidate(JSON.parse(request.input)),
        metadata: null,
      }),
    ],
    requests,
  );

  const result = await analyzePhase1Candidate({
    executionMode: "mock",
    modelClient: client,
    modelInput,
    sleepImpl: async () => {},
  });

  assert.equal(result.attempts[1].retry_kind, "invalid_json_repair");
  assert.ok(requests.every((request) => request.instructions === NOTIFICATION_ANALYSIS_PROMPT_P1));
  assert.deepEqual(JSON.parse(requests[1].input).repair_feedback, {
    error_code: "model_response_invalid",
    json_paths: ["/"],
    message: "The model response was not valid JSON output.",
  });
});

test("401, 403 and refusal stop after one provider attempt", async (t) => {
  const modelInput = await dev001Input();
  const cases = [
    [401, "model_auth_failed", "permanent_error"],
    [403, "model_auth_failed", "permanent_error"],
    [null, "model_refused", "refused"],
  ];

  for (const [status, code, outcome] of cases) {
    await t.test(status === null ? "refusal" : String(status), async () => {
      let calls = 0;
      const client = scriptedClient([
        async () => {
          calls += 1;
          throw new ModelRequestError("permanent", { status, code, outcome });
        },
      ]);
      await assert.rejects(
        analyzePhase1Candidate({ executionMode: "mock", modelClient: client, modelInput }),
        (error) =>
          error instanceof Phase1ModelAdapterError &&
          error.code === code &&
          error.attempts.length === 1 &&
          error.attemptBudgetExhausted === false,
      );
      assert.equal(calls, 1);
    });
  }
});

test("raw locator errors map to candidate_evidence_invalid and receive one controlled repair", async () => {
  const modelInput = await dev001Input();
  const requests = [];
  const client = scriptedClient(
    [
      async (request) => {
        const candidate = createDev001MockCandidate(JSON.parse(request.input));
        candidate.evidence[0].locator.start += 1;
        return { value: candidate, metadata: null };
      },
      async (request) => ({
        value: createDev001MockCandidate(JSON.parse(request.input)),
        metadata: null,
      }),
    ],
    requests,
  );

  const result = await analyzePhase1Candidate({
    executionMode: "mock",
    modelClient: client,
    modelInput,
  });

  assert.equal(result.attempts[0].error_code, "candidate_evidence_invalid");
  assert.equal(result.attempts[1].retry_kind, "candidate_repair");
  assert.equal(
    JSON.parse(requests[1].input).repair_feedback.error_code,
    "candidate_evidence_invalid",
  );
});
