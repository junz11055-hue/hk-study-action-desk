import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildStructuredRequestBody,
  ModelRequestError,
} from "../../src/agent/deepseek-responses-client.js";
import {
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  analyzePhase2rCoreCandidate,
  buildPhase2rRequestDescriptor,
  PHASE2R_DEEPSEEK_BASE_URL,
  PHASE2R_DEEPSEEK_MODEL,
  PHASE2R_MAX_REQUEST_UTF8_BYTES,
  PHASE2R_TIMEOUT_MS,
} from "../../src/v2/model/phase2r-core-model-adapter.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import {
  loadPhase2rDevelopmentInput,
  loadPhase2rDevelopmentInputs,
} from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  createCandidateFailureDiagnostic,
  createProviderFailureDiagnostic,
} from "../../src/v2/validation/core-candidate-failure-diagnostic.js";

const FIXED_TIME = "2026-08-31T12:00:00.000Z";
const sourceUrl = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const developmentCases = JSON.parse(await readFile(sourceUrl, "utf8"));
const sourceById = new Map(
  developmentCases.map((item) => [item.case_id, item]),
);

function referenceCandidate(caseId) {
  const developmentCase = sourceById.get(caseId);
  return buildReferenceCoreCandidateForEvaluation(
    developmentCase,
    projectCoreOverlapOracle(developmentCase),
  );
}

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

function mockClient(handler) {
  const calls = [];
  return {
    calls,
    client: {
      provider: "mock",
      model: "phase2r-offline-mock",
      configured: true,
      async createStructuredAttempt(request) {
        calls.push(request);
        return await handler(request, calls.length - 1);
      },
    },
  };
}

test("Phase 2R request keeps Candidate v2 frozen and all 16 cases below 10KB", async () => {
  const inputs = await loadPhase2rDevelopmentInputs();
  const descriptors = inputs.map(({ modelInput }) =>
    buildPhase2rRequestDescriptor(modelInput),
  );
  assert.equal(descriptors.length, 16);
  assert.equal(PHASE2R_MAX_REQUEST_UTF8_BYTES, 10_000);
  assert.ok(
    Math.max(...descriptors.map(({ request_utf8_bytes }) => request_utf8_bytes)) <=
      PHASE2R_MAX_REQUEST_UTF8_BYTES,
  );
  assert.equal(
    descriptors.every(
      ({ schema_hash }) =>
        schema_hash ===
        "sha256:279562aba228dd9c9d9f7356a32233dfc7270c021b16910bf7b4a9007a0ffb06",
    ),
    true,
  );
  assert.equal(
    hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
    descriptors[0].schema_hash,
  );
});

test("Phase 2R accepts one unchanged offline reference Candidate", async () => {
  const input = await loadPhase2rDevelopmentInput({ caseId: "DEV019" });
  const candidate = referenceCandidate("DEV019");
  const before = hashCanonicalJson(candidate);
  const fake = mockClient(async () => ({
    value: candidate,
    metadata: successMetadata(),
  }));
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network forbidden");
  };
  let result;
  try {
    result = await analyzePhase2rCoreCandidate({
      executionMode: "mock",
      modelClient: fake.client,
      caseId: "DEV019",
      clock: () => new Date(FIXED_TIME),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fake.calls.length, 1);
  assert.equal(fetchCalls, 0);
  assert.strictEqual(result.candidate, candidate);
  assert.equal(result.candidateHash, before);
  assert.equal(hashCanonicalJson(candidate), before);
  assert.equal(result.validation.candidate_unchanged, true);
  assert.equal(result.promptVersion, "notification-analysis-core-prompt-p2-v1");
  assert.equal(
    result.attempts[0].request_payload_hash,
    buildPhase2rRequestDescriptor(input.modelInput, {
      model: fake.client.model,
    }).request_payload_hash,
  );
});

test("a DeepSeek-shaped offline double binds its exact request body to the descriptor", async () => {
  const input = await loadPhase2rDevelopmentInput({ caseId: "DEV019" });
  const candidate = referenceCandidate("DEV019");
  let calls = 0;
  const modelClient = {
    provider: "deepseek",
    configured: true,
    model: PHASE2R_DEEPSEEK_MODEL,
    baseUrl: PHASE2R_DEEPSEEK_BASE_URL,
    timeoutMs: PHASE2R_TIMEOUT_MS,
    maxRetries: 1,
    async createStructuredAttempt(request) {
      calls += 1;
      const metadata = {
        ...successMetadata(),
        httpStatus: 200,
      };
      Object.defineProperty(metadata, "requestBody", {
        enumerable: false,
        value: buildStructuredRequestBody({
          model: PHASE2R_DEEPSEEK_MODEL,
          instructions: request.instructions,
          input: request.input,
          schema: request.schema,
          schemaName: request.schemaName,
          maxOutputTokens: request.maxOutputTokens,
        }),
      });
      return { value: candidate, metadata };
    },
  };
  const result = await analyzePhase2rCoreCandidate({
    executionMode: "deepseek",
    modelClient,
    caseId: "DEV019",
    clock: () => new Date(FIXED_TIME),
  });
  const descriptor = buildPhase2rRequestDescriptor(input.modelInput);
  assert.equal(calls, 1);
  assert.equal(
    result.attempts[0].request_payload_hash,
    descriptor.request_payload_hash,
  );
  assert.equal(result.promptHash, descriptor.prompt_hash);
});

test("Phase 2R retains only sanitized field families for representative reference failures", async (t) => {
  const scenarios = [
    {
      name: "dangling topic Claim",
      caseId: "DEV008",
      mutate(candidate) {
        candidate.topics[0].claim_refs[0] = "raw-topic-id-canary";
      },
      path: "$.topics[*].claim_refs",
      canary: "raw-topic-id-canary",
    },
    {
      name: "dangling Claim Evidence",
      caseId: "DEV020",
      mutate(candidate) {
        candidate.claims[0].evidence_refs[0] = "raw-evidence-id-canary";
      },
      path: "$.claims[*].evidence_refs",
      canary: "raw-evidence-id-canary",
    },
    {
      name: "unprojected profile reference",
      caseId: "DEV025",
      mutate(candidate) {
        candidate.applicability.profile_field_ids[0] = "raw-profile-id-canary";
      },
      path: "$.applicability.profile_field_ids",
      canary: "raw-profile-id-canary",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const candidate = structuredClone(referenceCandidate(scenario.caseId));
      scenario.mutate(candidate);
      const fake = mockClient(async () => ({
        value: candidate,
        metadata: successMetadata(),
      }));
      await assert.rejects(
        analyzePhase2rCoreCandidate({
          executionMode: "mock",
          modelClient: fake.client,
          caseId: scenario.caseId,
          clock: () => new Date(FIXED_TIME),
        }),
        (error) => {
          assert.equal(error.code, "candidate_reference_invalid");
          assert.equal(error.candidateHash, hashCanonicalJson(candidate));
          assert.equal(error.diagnostic.stage, "candidate_validation");
          assert.equal(error.diagnostic.reason, "reference_invalid");
          assert.deepEqual(error.diagnostic.field_paths, [scenario.path]);
          assert.equal("candidate" in error, false);
          assert.doesNotMatch(JSON.stringify(error), new RegExp(scenario.canary, "u"));
          return true;
        },
      );
      assert.equal(fake.calls.length, 1);
    });
  }
});

test("Phase 2R classifies both observed truncation shapes without retaining partial text", async (t) => {
  const scenarios = [
    { caseId: "DEV003", reasoningTokens: 7_603, partialBytes: 1_490 },
    { caseId: "DEV004", reasoningTokens: 8_000, partialBytes: 0 },
    { caseId: "DEV010", reasoningTokens: 7_389, partialBytes: 2_262 },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.caseId, async () => {
      const fake = mockClient(async () => {
        const error = new ModelRequestError("raw-partial-text-canary", {
          code: "model_response_invalid",
          outcome: "truncated",
        });
        error.attemptMetadata = {
          ...successMetadata(),
          httpStatus: 200,
          providerStatus: "incomplete",
          incompleteReason: "max_output_tokens",
          outputItemTypes:
            scenario.partialBytes === 0 ? ["reasoning"] : ["reasoning", "message"],
          outputItemCount: scenario.partialBytes === 0 ? 1 : 2,
          partialVisibleOutputPresent: scenario.partialBytes > 0,
          partialVisibleOutputUtf8Bytes: scenario.partialBytes,
          partialVisibleOutputSha256:
            scenario.partialBytes > 0 ? `sha256:${"1".repeat(64)}` : null,
          inputTokens: 2_500,
          outputTokens: 8_000,
          reasoningTokens: scenario.reasoningTokens,
        };
        throw error;
      });
      await assert.rejects(
        analyzePhase2rCoreCandidate({
          executionMode: "mock",
          modelClient: fake.client,
          caseId: scenario.caseId,
          clock: () => new Date(FIXED_TIME),
        }),
        (error) => {
          assert.equal(error.code, "model_response_invalid");
          assert.equal(error.attempts[0].outcome, "truncated");
          assert.equal(error.attempts[0].provider_status, "incomplete");
          assert.equal(error.attempts[0].incomplete_reason, "max_output_tokens");
          assert.equal(error.attempts[0].output_tokens, 8_000);
          assert.equal(error.attempts[0].reasoning_tokens, scenario.reasoningTokens);
          assert.equal(error.attempts[0].partial_output_bytes, scenario.partialBytes);
          assert.equal(
            error.attempts[0].partial_output_present,
            scenario.partialBytes > 0,
          );
          assert.equal(
            error.attempts[0].partial_output_hash !== null,
            scenario.partialBytes > 0,
          );
          assert.equal(error.diagnostic.stage, "provider_response");
          assert.equal(error.diagnostic.reason, "output_truncated");
          assert.doesNotMatch(JSON.stringify(error), /raw-partial-text-canary/u);
          return true;
        },
      );
      assert.equal(fake.calls.length, 1);
    });
  }
});

test("Phase 2R rejects drifted DeepSeek transport settings before any request", async (t) => {
  const defaults = {
    provider: "deepseek",
    configured: true,
    model: PHASE2R_DEEPSEEK_MODEL,
    baseUrl: PHASE2R_DEEPSEEK_BASE_URL,
    timeoutMs: PHASE2R_TIMEOUT_MS,
    maxRetries: 1,
  };
  const changes = [
    ["model", "deepseek-chat"],
    ["baseUrl", "https://example.invalid"],
    ["timeoutMs", PHASE2R_TIMEOUT_MS - 1],
    ["maxRetries", 2],
  ];
  for (const [field, value] of changes) {
    await t.test(field, async () => {
      let calls = 0;
      const modelClient = {
        ...defaults,
        [field]: value,
        async createStructuredAttempt() {
          calls += 1;
          throw new Error("must not be reached");
        },
      };
      await assert.rejects(
        analyzePhase2rCoreCandidate({
          executionMode: "deepseek",
          modelClient,
          caseId: "DEV001",
        }),
        { code: "internal_error" },
      );
      assert.equal(calls, 0);
    });
  }
});

test("diagnostics distinguish provider incompletion and scrub unknown Candidate fields", () => {
  assert.equal(
    createProviderFailureDiagnostic({
      outcome: "permanent_error",
      code: "model_response_invalid",
      providerStatus: "incomplete",
      incompleteReason: "content_filter",
    }).reason,
    "provider_incomplete",
  );
  assert.equal(
    createProviderFailureDiagnostic({
      outcome: "invalid_json",
      code: "model_response_invalid",
      providerStatus: "completed",
    }).reason,
    "invalid_json",
  );
  const diagnostic = createCandidateFailureDiagnostic({
    candidate: {
      claims: [],
      evidence: [],
      topics: [],
      actions: [],
      deadlines: [],
      "raw-candidate-field-canary": "raw-body-canary",
    },
    code: "candidate_schema_invalid",
    jsonPaths: ["$.raw-candidate-field-canary"],
  });
  assert.deepEqual(diagnostic.field_paths, ["$.*"]);
  assert.doesNotMatch(JSON.stringify(diagnostic), /raw-candidate|raw-body/u);
});
