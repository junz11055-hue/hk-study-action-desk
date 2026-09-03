import assert from "node:assert/strict";
import test from "node:test";

import { buildPhase2rRequestDescriptor } from "../../src/v2/model/phase2r-core-model-adapter.js";
import { loadPhase2rDevelopmentInput } from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import {
  PHASE2RB_BASE_URL,
  PHASE2RB_CASE_IDS,
  PHASE2RB_CASE_SET_HASH,
  PHASE2RB_CLIENT_MAX_RETRIES,
  PHASE2RB_MAX_OUTPUT_TOKENS,
  PHASE2RB_MAX_REQUESTS,
  PHASE2RB_MAX_TOTAL_OUTPUT_TOKENS,
  PHASE2RB_MODEL,
  PHASE2RB_REQUESTS_PER_CASE,
  PHASE2RB_RETRIES,
  PHASE2RB_SERIAL,
  PHASE2RB_TIMEOUT_MS,
} from "../../src/v2/phase2rb/phase2rb-run-contract.js";
import { Phase2rbRequestBudget } from "../../src/v2/phase2rb/phase2rb-candidate-capture.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const EXPECTED = Object.freeze({
  DEV001: {
    modelInputHash:
      "sha256:5f7e4d9e243e95a0f11ac7736f330252d6939ff845658cd91b04e88177888b5e",
    requestPayloadHash:
      "sha256:44e12abde3db8918112f0a3e2bdd2938d0ab1415ec2acd1ae6aa8691bf922240",
    requestBytes: 9_424,
  },
  DEV006: {
    modelInputHash:
      "sha256:de34434353a0dc6c5b7a1b0fe2ffe05ed1bbacee416bb75b225dfb9db452ea60",
    requestPayloadHash:
      "sha256:c77e3b59f59f817e6d1b894d930908f352115545a71c61a4385cf3f7bcad7fbc",
    requestBytes: 9_316,
  },
  DEV008: {
    modelInputHash:
      "sha256:32044ff58a2eb6ddce131c90e366573b91271f1673d94a0d59f697537b03799f",
    requestPayloadHash:
      "sha256:1b8112e2d4b5bfd725ed36420a2836b035f8f0c93a768140ade06b79728d56ec",
    requestBytes: 9_401,
  },
  DEV010: {
    modelInputHash:
      "sha256:a861e6f89ecdb970611d49b2efe97cb423a2f7e1070667cb318fd428b0855ef0",
    requestPayloadHash:
      "sha256:40632fdc91277efbacbf6374ab9bb1294d69a3cf3b0e9d853e69be8989b0536d",
    requestBytes: 9_481,
  },
});

test("Phase 2R-B freezes exactly four approved cases and one attempt each", () => {
  assert.deepEqual(PHASE2RB_CASE_IDS, ["DEV001", "DEV006", "DEV008", "DEV010"]);
  assert.equal(PHASE2RB_CASE_SET_HASH, hashCanonicalJson(PHASE2RB_CASE_IDS));
  assert.equal(PHASE2RB_MAX_REQUESTS, 4);
  assert.equal(PHASE2RB_REQUESTS_PER_CASE, 1);
  assert.equal(PHASE2RB_SERIAL, true);
  assert.equal(PHASE2RB_RETRIES, 0);
  assert.equal(PHASE2RB_CLIENT_MAX_RETRIES, 1);
  assert.equal(PHASE2RB_MAX_OUTPUT_TOKENS, 8_000);
  assert.equal(PHASE2RB_MAX_TOTAL_OUTPUT_TOKENS, 32_000);
  assert.equal(PHASE2RB_TIMEOUT_MS, 90_000);
  assert.equal(PHASE2RB_MODEL, "deepseek-v4-flash");
  assert.equal(PHASE2RB_BASE_URL, "https://api.deepseek.com");
  assert.equal(Object.isFrozen(PHASE2RB_CASE_IDS), true);
});

test("Every approved request descriptor matches its frozen Input and payload Hash", async () => {
  for (const caseId of PHASE2RB_CASE_IDS) {
    const input = await loadPhase2rDevelopmentInput({ caseId });
    const descriptor = buildPhase2rRequestDescriptor(input.modelInput);
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

test("Phase 2R-B request budget rejects reordering, duplicates, and a fifth request", () => {
  const reordered = new Phase2rbRequestBudget();
  assert.throws(() => reordered.reserve("DEV006"), /frozen order/u);

  const duplicate = new Phase2rbRequestBudget();
  duplicate.reserve("DEV001");
  assert.throws(() => duplicate.reserve("DEV001"), /frozen order/u);

  const exhausted = new Phase2rbRequestBudget();
  for (const caseId of PHASE2RB_CASE_IDS) exhausted.reserve(caseId);
  assert.equal(exhausted.complete, true);
  assert.equal(exhausted.used, 4);
  assert.throws(() => exhausted.reserve("DEV001"), /exceed four/u);
});
