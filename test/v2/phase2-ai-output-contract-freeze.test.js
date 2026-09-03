import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_AI_OUTPUT_CONTRACT,
  AI_OUTPUT_CONTRACTS,
  AI_OUTPUT_CONTRACT_MANIFEST_VERSION,
  LEGACY_AI_OUTPUT_CONTRACT,
} from "../../src/v2/contracts/ai-output-contract-manifest.js";
import {
  CANDIDATE_SCHEMA_DIALECT,
  CANDIDATE_SCHEMA_NAME,
  CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-candidate-p1.schema.js";
import {
  CORE_CANDIDATE_SCHEMA_DIALECT,
  CORE_CANDIDATE_SCHEMA_NAME,
  CORE_CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
} from "../../src/v2/contracts/phase2-evaluation-record-v1.schema.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

test("AI Output manifest is append-only, unique, and has one active contract", () => {
  assert.equal(
    AI_OUTPUT_CONTRACT_MANIFEST_VERSION,
    "ai-output-contract-manifest-v1",
  );
  assert.equal(
    new Set(AI_OUTPUT_CONTRACTS.map((item) => item.schema_version)).size,
    2,
  );
  assert.deepEqual(
    AI_OUTPUT_CONTRACTS.filter((item) => item.status === "active"),
    [ACTIVE_AI_OUTPUT_CONTRACT],
  );
});

test("legacy Candidate v1 remains hash-pinned but is not the active interface", () => {
  assert.equal(CANDIDATE_SCHEMA_VERSION, LEGACY_AI_OUTPUT_CONTRACT.schema_version);
  assert.equal(CANDIDATE_SCHEMA_NAME, LEGACY_AI_OUTPUT_CONTRACT.schema_name);
  assert.equal(CANDIDATE_SCHEMA_DIALECT, LEGACY_AI_OUTPUT_CONTRACT.schema_dialect);
  assert.equal(
    hashCanonicalJson(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA),
    LEGACY_AI_OUTPUT_CONTRACT.canonical_schema_hash,
  );
});

test("Core Candidate v2 is the exact active AI Output interface for Phase 2", () => {
  assert.equal(
    CORE_CANDIDATE_SCHEMA_VERSION,
    ACTIVE_AI_OUTPUT_CONTRACT.schema_version,
  );
  assert.equal(CORE_CANDIDATE_SCHEMA_NAME, ACTIVE_AI_OUTPUT_CONTRACT.schema_name);
  assert.equal(
    CORE_CANDIDATE_SCHEMA_DIALECT,
    ACTIVE_AI_OUTPUT_CONTRACT.schema_dialect,
  );
  assert.equal(
    hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
    ACTIVE_AI_OUTPUT_CONTRACT.canonical_schema_hash,
  );
  assert.deepEqual(
    NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA.required,
    ACTIVE_AI_OUTPUT_CONTRACT.root_fields,
  );
  assert.equal(
    PHASE2_CANDIDATE_SCHEMA_VERSION,
    ACTIVE_AI_OUTPUT_CONTRACT.schema_version,
  );
  assert.equal(
    PHASE2_CANDIDATE_SCHEMA_HASH,
    ACTIVE_AI_OUTPUT_CONTRACT.canonical_schema_hash,
  );
});
