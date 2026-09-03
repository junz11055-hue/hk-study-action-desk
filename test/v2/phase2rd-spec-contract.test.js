import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPhase2rDevelopmentInput } from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import {
  buildPhase2rcRequestDescriptor,
  PHASE2RC_PROMPT_HASH,
  PHASE2RC_SCHEMA_HASH,
} from "../../src/v2/phase2rc/phase2rc-request-contract.js";
import {
  PHASE2RD_APPROVAL_STATE,
  PHASE2RD_AUTOMATIC_RETRIES,
  PHASE2RD_CASE_IDS,
  PHASE2RD_CLIENT_MAX_RETRIES,
  PHASE2RD_EXPLICIT_SAMPLING_PARAMETERS,
  PHASE2RD_FROZEN_REQUESTS,
  PHASE2RD_LIVE_EXECUTION_AUTHORIZED,
  PHASE2RD_MAX_OUTPUT_TOKENS_PER_CASE,
  PHASE2RD_MAX_REQUESTS,
  PHASE2RD_MAX_TOTAL_OUTPUT_TOKENS,
  PHASE2RD_OVER_REJECTION_CONTROL_CASE_IDS,
  PHASE2RD_PASS_GATES,
  PHASE2RD_PROMPT_HASH,
  PHASE2RD_REGRESSION_CASE_IDS,
  PHASE2RD_REQUESTS_PER_CASE,
  PHASE2RD_RUNTIME_DIRECTORY,
  PHASE2RD_SCHEMA_HASH,
  PHASE2RD_SERIAL,
  PHASE2RD_STORE,
  PHASE2RD_TIMEOUT_MS,
  PHASE2RD_TOOLS_ENABLED,
} from "../../src/v2/phase2rd/phase2rd-spec-contract.js";
import { canonicalJsonStringify } from "../../src/v2/validation/canonical-json.js";

test("Phase 2R-D freezes six paired cases and a separate budget", () => {
  assert.deepEqual(PHASE2RD_CASE_IDS, [
    "DEV001", "DEV005", "DEV006", "DEV007", "DEV008", "DEV010",
  ]);
  assert.deepEqual(PHASE2RD_REGRESSION_CASE_IDS, [
    "DEV001", "DEV006", "DEV008", "DEV010",
  ]);
  assert.deepEqual(PHASE2RD_OVER_REJECTION_CONTROL_CASE_IDS, [
    "DEV005", "DEV007",
  ]);
  assert.equal(PHASE2RD_MAX_REQUESTS, 6);
  assert.equal(PHASE2RD_REQUESTS_PER_CASE, 1);
  assert.equal(PHASE2RD_SERIAL, true);
  assert.equal(PHASE2RD_AUTOMATIC_RETRIES, 0);
  assert.equal(PHASE2RD_CLIENT_MAX_RETRIES, 1);
  assert.equal(PHASE2RD_MAX_OUTPUT_TOKENS_PER_CASE, 8_000);
  assert.equal(PHASE2RD_MAX_TOTAL_OUTPUT_TOKENS, 48_000);
  assert.equal(PHASE2RD_TIMEOUT_MS, 90_000);
  assert.equal(PHASE2RD_STORE, false);
  assert.equal(PHASE2RD_TOOLS_ENABLED, false);
  assert.equal(PHASE2RD_EXPLICIT_SAMPLING_PARAMETERS, false);
  assert.equal(PHASE2RD_RUNTIME_DIRECTORY, ".runtime/phase-2rd");
});

test("Phase 2R-D descriptors are exact projections of the frozen p2-v2 inputs", async () => {
  assert.equal(PHASE2RD_PROMPT_HASH, PHASE2RC_PROMPT_HASH);
  assert.equal(PHASE2RD_SCHEMA_HASH, PHASE2RC_SCHEMA_HASH);
  const actual = [];
  for (const caseId of PHASE2RD_CASE_IDS) {
    const { modelInput } = await loadPhase2rDevelopmentInput({ caseId });
    const descriptor = buildPhase2rcRequestDescriptor(modelInput);
    actual.push({
      case_id: caseId,
      model_input_hash: descriptor.model_input_hash,
      request_payload_hash: descriptor.request_payload_hash,
      request_utf8_bytes: descriptor.request_utf8_bytes,
    });
  }
  assert.deepEqual(actual, PHASE2RD_FROZEN_REQUESTS);
});

test("paired controls keep the message and source fixed while changing only profile refs", async () => {
  for (const [controlId, regressionId] of [
    ["DEV005", "DEV006"],
    ["DEV007", "DEV008"],
  ]) {
    const control = (await loadPhase2rDevelopmentInput({ caseId: controlId })).modelInput;
    const regression = (await loadPhase2rDevelopmentInput({ caseId: regressionId })).modelInput;
    assert.equal(
      canonicalJsonStringify(control.message),
      canonicalJsonStringify(regression.message),
    );
    assert.equal(
      canonicalJsonStringify(control.source_context),
      canonicalJsonStringify(regression.source_context),
    );
    assert.notEqual(
      canonicalJsonStringify(control.profile_refs),
      canonicalJsonStringify(regression.profile_refs),
    );
  }
});

test("Phase 2R-D authorization remains limited to the fixed six-case run", async () => {
  assert.equal(
    PHASE2RD_APPROVAL_STATE,
    "implementation_and_fixed_six_case_execution_authorized",
  );
  assert.equal(PHASE2RD_LIVE_EXECUTION_AUTHORIZED, true);
  assert.deepEqual(PHASE2RD_PASS_GATES, {
    technicalCandidates: { passed: 6, total: 6 },
    semanticGate: { passed: 6, total: 6 },
    automaticDimensions: { exact: 36, total: 36 },
    manualReview: { resolved: 30, total: 30 },
    maximumP0: 0,
    maximumP1PerCase: 2,
  });

  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["phase2r-d:deepseek"],
    "node src/v2/phase2rd/run-phase2rd-deepseek.js",
  );
  assert.match(packageJson.scripts["phase2r-d:evaluate"], /run-phase2rd-evaluate/u);

  const contractSource = await readFile(
    new URL(
      "../../src/v2/phase2rd/phase2rd-spec-contract.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(contractSource, /\b(?:import|require)\b|\bprocess\.env\b/u);
  assert.doesNotMatch(
    contractSource,
    /\bfetch\s*\(|\.listen\s*\(|readFile|writeFile|createDeepseek/u,
  );
});
