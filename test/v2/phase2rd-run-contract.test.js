import assert from "node:assert/strict";
import test from "node:test";

import { buildPhase2rdRequestDescriptor } from "../../src/v2/model/phase2rd-core-model-adapter.js";
import { loadPhase2rDevelopmentInput } from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import {
  PHASE2RD_BASE_URL,
  PHASE2RD_CASE_IDS,
  PHASE2RD_CASE_SET_HASH,
  PHASE2RD_CLIENT_MAX_RETRIES,
  PHASE2RD_MAX_OUTPUT_TOKENS,
  PHASE2RD_MAX_REQUESTS,
  PHASE2RD_MAX_TOTAL_OUTPUT_TOKENS,
  PHASE2RD_MODEL,
  PHASE2RD_REQUESTS_PER_CASE,
  PHASE2RD_RETRIES,
  PHASE2RD_SERIAL,
  PHASE2RD_TIMEOUT_MS,
} from "../../src/v2/phase2rd/phase2rd-run-contract.js";
import { Phase2rdRequestBudget } from "../../src/v2/phase2rd/phase2rd-candidate-capture.js";
import { PHASE2RD_FROZEN_REQUESTS } from "../../src/v2/phase2rd/phase2rd-spec-contract.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const EXPECTED = Object.freeze(Object.fromEntries(
  PHASE2RD_FROZEN_REQUESTS.map((item) => [item.case_id, {
    modelInputHash: item.model_input_hash,
    requestPayloadHash: item.request_payload_hash,
    requestBytes: item.request_utf8_bytes,
  }]),
));

test("Phase 2R-D freezes exactly six approved cases and one attempt each", () => {
  assert.deepEqual(PHASE2RD_CASE_IDS, [
    "DEV001", "DEV005", "DEV006", "DEV007", "DEV008", "DEV010",
  ]);
  assert.equal(PHASE2RD_CASE_SET_HASH, hashCanonicalJson(PHASE2RD_CASE_IDS));
  assert.equal(PHASE2RD_MAX_REQUESTS, 6);
  assert.equal(PHASE2RD_REQUESTS_PER_CASE, 1);
  assert.equal(PHASE2RD_SERIAL, true);
  assert.equal(PHASE2RD_RETRIES, 0);
  assert.equal(PHASE2RD_CLIENT_MAX_RETRIES, 1);
  assert.equal(PHASE2RD_MAX_OUTPUT_TOKENS, 8_000);
  assert.equal(PHASE2RD_MAX_TOTAL_OUTPUT_TOKENS, 48_000);
  assert.equal(PHASE2RD_TIMEOUT_MS, 90_000);
  assert.equal(PHASE2RD_MODEL, "deepseek-v4-flash");
  assert.equal(PHASE2RD_BASE_URL, "https://api.deepseek.com");
  assert.equal(Object.isFrozen(PHASE2RD_CASE_IDS), true);
});

test("Every approved request descriptor matches its frozen Input and payload Hash", async () => {
  for (const caseId of PHASE2RD_CASE_IDS) {
    const input = await loadPhase2rDevelopmentInput({ caseId });
    const descriptor = buildPhase2rdRequestDescriptor(input.modelInput);
    assert.equal(input.modelInputHash, EXPECTED[caseId].modelInputHash, caseId);
    assert.equal(descriptor.model_input_hash, EXPECTED[caseId].modelInputHash, caseId);
    assert.equal(
      descriptor.request_payload_hash,
      EXPECTED[caseId].requestPayloadHash,
      caseId,
    );
    assert.equal(descriptor.request_utf8_bytes, EXPECTED[caseId].requestBytes, caseId);
  }
});

test("Phase 2R-D request budget rejects reordering, duplicates, and a seventh request", () => {
  const reordered = new Phase2rdRequestBudget();
  assert.throws(() => reordered.reserve("DEV006"), /frozen order/u);

  const duplicate = new Phase2rdRequestBudget();
  duplicate.reserve("DEV001");
  assert.throws(() => duplicate.reserve("DEV001"), /frozen order/u);

  const exhausted = new Phase2rdRequestBudget();
  for (const caseId of PHASE2RD_CASE_IDS) exhausted.reserve(caseId);
  assert.equal(exhausted.complete, true);
  assert.equal(exhausted.used, 6);
  assert.throws(() => exhausted.reserve("DEV001"), /exceed six/u);
});
