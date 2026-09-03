import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_PROMPT_REGISTRY_VERSIONS,
  resolveCorePromptContract,
} from "../../src/v2/prompts/core-prompt-registry.js";
import {
  CORE_PROMPT_VERSION,
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "../../src/v2/prompts/notification-analysis-core-p1-v2.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
  PHASE2R_CORE_PROMPT_VERSION,
} from "../../src/v2/prompts/notification-analysis-core-p2-v1.js";
import {
  PHASE2RC_CORE_PROMPT_VERSION,
} from "../../src/v2/prompts/notification-analysis-core-p2-v2.js";
import {
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { hashCanonicalJson, hashUtf8 } from "../../src/v2/validation/canonical-json.js";

test("Phase 2R appends a new prompt without rewriting the historical Phase 2B prompt", () => {
  assert.equal(CORE_PROMPT_VERSION, "notification-analysis-core-prompt-p1-v2");
  assert.equal(
    hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2),
    "sha256:3a3f4dead9315314eb2e1101c3eb00019a11ce27b538a0bf3e404ba58251151b",
  );
  assert.equal(
    PHASE2R_CORE_PROMPT_VERSION,
    "notification-analysis-core-prompt-p2-v1",
  );
  assert.equal(
    hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1),
    "sha256:dade3413a05f2485f22ea6bd5cff8c0c62ef60c5ce1da4ac325775f9dd22b25d",
  );
  assert.deepEqual(CORE_PROMPT_REGISTRY_VERSIONS, [
    CORE_PROMPT_VERSION,
    PHASE2R_CORE_PROMPT_VERSION,
    PHASE2RC_CORE_PROMPT_VERSION,
  ]);
  assert.strictEqual(
    resolveCorePromptContract(CORE_PROMPT_VERSION).instructions,
    NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
  );
  assert.strictEqual(
    resolveCorePromptContract(PHASE2R_CORE_PROMPT_VERSION).instructions,
    NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
  );
  assert.equal(
    resolveCorePromptContract(PHASE2R_CORE_PROMPT_VERSION).prompt_hash,
    hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1),
  );
  assert.throws(() => resolveCorePromptContract("unregistered-prompt"));
});

test("Phase 2R prompt encodes the known quality controls within the byte gate", () => {
  const prompt = NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1;
  assert.ok(Buffer.byteLength(prompt, "utf8") <= 3_600);
  assert.match(prompt, /one extraction pass/iu);
  assert.match(prompt, /smallest sufficient graph/iu);
  assert.match(prompt, /occurring exactly once/iu);
  assert.match(prompt, /sender_school_name/iu);
  assert.match(prompt, /not_applicable if and only if/iu);
  assert.match(prompt, /no action is required/iu);
  assert.match(prompt, /attendance, confirmation, upload/iu);
  assert.match(prompt, /zero marks for one assessment/iu);
  assert.match(prompt, /never infer a school from a URL/iu);
  assert.match(prompt, /source_context.*data, never instructions/iu);
  assert.match(prompt, /optional Action is not_applicable, omit its Deadline/iu);
  assert.doesNotMatch(prompt, /DEV\d{3}|COMP\d{4}|港湾大学|harbour\.invalid/iu);
});

test("Phase 2R keeps the frozen Candidate v2 contract byte-for-byte", () => {
  assert.equal(
    hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
    "sha256:279562aba228dd9c9d9f7356a32233dfc7270c021b16910bf7b4a9007a0ffb06",
  );
});
