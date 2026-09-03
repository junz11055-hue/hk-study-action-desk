import { readFile } from "node:fs/promises";

import {
  buildStructuredRequestBody,
  ModelRequestError,
} from "../../src/agent/deepseek-responses-client.js";
import { buildReferenceCoreCandidateForEvaluation, projectCoreOverlapOracle } from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import { projectPhase2DevelopmentInput } from "../../src/v2/phase2/development-input-snapshot-builder.js";
import { PHASE2_DEVELOPMENT_CASE_IDS } from "../../src/v2/phase2/development-input-loader.js";
import {
  PHASE2B_DEEPSEEK_BASE_URL,
  PHASE2B_DEEPSEEK_MODEL,
  PHASE2B_TIMEOUT_MS,
} from "../../src/v2/model/phase2-core-model-adapter.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const fixtureUrl = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

export async function referenceCandidatesByInputHash() {
  const parsed = JSON.parse(await readFile(fixtureUrl, "utf8"));
  return new Map(
    PHASE2_DEVELOPMENT_CASE_IDS.map((caseId) => {
      const developmentCase = parsed.find((item) => item.case_id === caseId);
      const modelInput = projectPhase2DevelopmentInput(developmentCase);
      const oracle = projectCoreOverlapOracle(developmentCase);
      return [
        hashCanonicalJson(modelInput),
        buildReferenceCoreCandidateForEvaluation(developmentCase, oracle),
      ];
    }),
  );
}

export function createFakePhase2bDeepSeekClient({
  candidates,
  mutateCandidate,
  failAt = null,
  apiKey = "test-key-canary-not-for-records",
  delay = async () => {},
} = {}) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const client = {
    provider: "deepseek",
    apiKey,
    model: PHASE2B_DEEPSEEK_MODEL,
    baseUrl: PHASE2B_DEEPSEEK_BASE_URL,
    timeoutMs: PHASE2B_TIMEOUT_MS,
    maxRetries: 1,
    get configured() {
      return Boolean(this.apiKey);
    },
    async createStructuredAttempt(request) {
      const modelInput = JSON.parse(request.input);
      const inputHash = hashCanonicalJson(modelInput);
      const callIndex = calls.length;
      calls.push({ inputHash, modelInput, request });
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await delay(callIndex);
        if (failAt === callIndex) {
          const error = new ModelRequestError("synthetic transport failure", {
            code: "model_transport_failed",
            outcome: "transient_error",
            retryable: false,
          });
          throw error;
        }
        const source = candidates.get(inputHash);
        if (!source) throw new Error("missing fake Candidate");
        const candidate = JSON.parse(JSON.stringify(source));
        mutateCandidate?.(candidate, callIndex, modelInput);
        const requestBody = buildStructuredRequestBody({
          model: PHASE2B_DEEPSEEK_MODEL,
          instructions: request.instructions,
          input: request.input,
          schema: request.schema,
          schemaName: request.schemaName,
          maxOutputTokens: request.maxOutputTokens,
        });
        const metadata = {
          requestId: `fake-request-${callIndex + 1}`,
          startedAt: "2026-08-31T10:00:00.000Z",
          finishedAt: "2026-08-31T10:00:00.010Z",
          durationMs: 10,
          httpStatus: 200,
          providerStatus: "completed",
          incompleteReason: null,
          outputItemTypes: ["message"],
          outputItemCount: 1,
          partialVisibleOutputPresent: false,
          partialVisibleOutputUtf8Bytes: 0,
          partialVisibleOutputSha256: null,
          inputTokens: 100 + callIndex,
          outputTokens: 200 + callIndex,
          reasoningTokens: 120 + callIndex,
          outputTextTokens: 80,
          maxOutputTokens: request.maxOutputTokens,
        };
        Object.defineProperty(metadata, "requestBody", {
          enumerable: false,
          value: requestBody,
        });
        return { value: candidate, metadata };
      } catch (error) {
        if (!error.attemptMetadata) {
          const requestBody = buildStructuredRequestBody({
            model: PHASE2B_DEEPSEEK_MODEL,
            instructions: request.instructions,
            input: request.input,
            schema: request.schema,
            schemaName: request.schemaName,
            maxOutputTokens: request.maxOutputTokens,
          });
          const metadata = {
            requestId: `fake-request-${callIndex + 1}`,
            startedAt: "2026-08-31T10:00:00.000Z",
            finishedAt: "2026-08-31T10:00:00.010Z",
            durationMs: 10,
            httpStatus: null,
            providerStatus: null,
            incompleteReason: null,
            outputItemTypes: [],
            outputItemCount: 0,
            partialVisibleOutputPresent: false,
            partialVisibleOutputUtf8Bytes: 0,
            partialVisibleOutputSha256: null,
            inputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            outputTextTokens: null,
            maxOutputTokens: request.maxOutputTokens,
          };
          Object.defineProperty(metadata, "requestBody", {
            enumerable: false,
            value: requestBody,
          });
          error.attemptMetadata = metadata;
        }
        throw error;
      } finally {
        active -= 1;
      }
    },
  };
  return { client, calls, get maxActive() { return maxActive; } };
}
