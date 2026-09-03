import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzePhase2CoreCandidate,
  buildPhase2bRequestDescriptor,
  PHASE2B_MAX_REQUEST_UTF8_BYTES,
} from "../../src/v2/model/phase2-core-model-adapter.js";
import { loadPhase2DevelopmentInput } from "../../src/v2/phase2/development-input-loader.js";
import { referenceCandidatesByInputHash, createFakePhase2bDeepSeekClient } from "./phase2b-test-helpers.js";

test("Phase 2B adapter accepts multilingual multi-profile Input with one attempt", async () => {
  const candidates = await referenceCandidatesByInputHash();
  const input = await loadPhase2DevelopmentInput({ caseId: "DEV003" });
  const fake = createFakePhase2bDeepSeekClient({ candidates });
  const result = await analyzePhase2CoreCandidate({
    modelClient: fake.client,
    modelInput: input.modelInput,
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.validation.candidate_unchanged, true);
  assert.deepEqual(result.candidate, candidates.get(input.modelInputHash));
});

test("Phase 2B request descriptor remains within the shared frozen 10KB gate", async () => {
  const input = await loadPhase2DevelopmentInput({ caseId: "DEV024" });
  const descriptor = buildPhase2bRequestDescriptor(input.modelInput);
  assert.match(descriptor.request_payload_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(PHASE2B_MAX_REQUEST_UTF8_BYTES, 10_000);
});

test("Phase 2B adapter rejects a drifted Input before provider transport", async () => {
  const candidates = await referenceCandidatesByInputHash();
  const input = await loadPhase2DevelopmentInput({ caseId: "DEV003" });
  const fake = createFakePhase2bDeepSeekClient({ candidates });
  const drifted = JSON.parse(JSON.stringify(input.modelInput));
  drifted.expected = { forbidden: true };
  await assert.rejects(
    analyzePhase2CoreCandidate({
      modelClient: fake.client,
      modelInput: drifted,
    }),
  );
  assert.equal(fake.calls.length, 0);
});
