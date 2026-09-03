import assert from "node:assert/strict";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CORE_CANDIDATE_SCHEMA_DIALECT,
  CORE_CANDIDATE_SCHEMA_NAME,
  CORE_CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { makeCoreCandidate } from "./core-test-fixtures.js";

test("Core Candidate v2 freezes a provider-safe, closed eleven-field contract", () => {
  assert.equal(
    CORE_CANDIDATE_SCHEMA_DIALECT,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(
    CORE_CANDIDATE_SCHEMA_VERSION,
    "notification-analysis-core-candidate-p1-v2",
  );
  assert.equal(
    CORE_CANDIDATE_SCHEMA_NAME,
    "notification_analysis_core_candidate_p1_v2",
  );
  assert.equal(
    Object.hasOwn(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA, "$schema"),
    false,
  );
  assert.ok(Object.isFrozen(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA));
  assert.equal(
    hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
    "sha256:279562aba228dd9c9d9f7356a32233dfc7270c021b16910bf7b4a9007a0ffb06",
    "a schema change requires a new interface version and explicit approval",
  );
  assert.deepEqual(
    NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA.required,
    [
      "title_zh",
      "title_claim_refs",
      "summary_zh",
      "summary_claim_refs",
      "topics",
      "applicability",
      "claims",
      "evidence",
      "actions",
      "deadlines",
      "consequence",
    ],
  );

  const allowedKeywords = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "pattern",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
  ]);
  function inspect(schema, path = "$schema") {
    for (const key of Object.keys(schema)) {
      assert.ok(allowedKeywords.has(key), `${path} uses ${key}`);
    }
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, `${path} must close`);
      for (const [name, child] of Object.entries(schema.properties)) {
        inspect(child, `${path}.${name}`);
      }
    }
    if (schema.items) inspect(schema.items, `${path}[]`);
  }
  inspect(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA);
});

test("Core Candidate v2 compiles strictly and accepts the complete DEV001 mock", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
  );
  assert.equal(validate(makeCoreCandidate()), true, JSON.stringify(validate.errors));
});

test("Core Candidate v2 rejects missing, extra, out-of-range, and legacy v1 fields", async (t) => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
  );
  const rejects = (mutator) => {
    const candidate = makeCoreCandidate();
    mutator(candidate);
    assert.equal(validate(candidate), false);
  };

  await t.test("missing root", () => rejects((value) => delete value.deadlines));
  await t.test("extra root", () => rejects((value) => (value.notification_id = "DEV001")));
  await t.test("extra nested", () =>
    rejects((value) => (value.evidence[0].source = "body")));
  await t.test("legacy locator", () =>
    rejects(
      (value) =>
        (value.evidence[0].locator = { kind: "utf16_range", start: 0, end: 1 }),
    ));
  await t.test("legacy obligation", () =>
    rejects((value) => (value.actions[0].obligation = "conditional_mandatory")));
  await t.test("empty claim evidence", () =>
    rejects((value) => (value.claims[0].evidence_refs = [])));
  await t.test("too many topics", () =>
    rejects(
      (value) =>
        (value.topics = Array.from({ length: 4 }, (_, index) => ({
          label: "专业与课程",
          claim_refs: [value.claims[index % value.claims.length].claim_id],
        }))),
    ));
});

test("Core v2 Schema and compact mock stay inside approved byte budgets", () => {
  assert.ok(
    Buffer.byteLength(
      JSON.stringify(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
      "utf8",
    ) <= 6_000,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(makeCoreCandidate()), "utf8") <= 3_000);
});
