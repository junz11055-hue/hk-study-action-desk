import assert from "node:assert/strict";
import test from "node:test";

import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { loadPhase2DevelopmentInputs } from "../../src/v2/phase2/development-input-loader.js";
import {
  PHASE2_ALLOWED_MESSAGE_LANGUAGES,
  PHASE2_ALLOWED_PROFILE_FIELD_TYPES,
  PHASE2_MAX_MODEL_INPUT_UTF8_BYTES,
  PHASE2_MODEL_INPUT_PROJECTION_VERSION,
  Phase2ModelInputValidationError,
  validatePhase2ModelInput,
} from "../../src/v2/phase2/phase2-model-input-validator.js";

function makeModelInput() {
  return {
    task_type: "analyze_school_notification_core",
    target_language: "zh-Hans",
    candidate_schema_version: "notification-analysis-core-candidate-p1-v2",
    message: {
      subject: "Synthetic programme notice",
      language: "en",
      body: "Read the synthetic notice at https://notices.harbour.invalid/item/1.",
    },
    profile_refs: [
      {
        profile_field_id: "pf-school",
        field_type: "school",
        value: "港湾大学",
      },
      {
        profile_field_id: "pf-programme",
        field_type: "programme",
        value: "MSc Computing | aliases: MSC-COMP",
      },
      {
        profile_field_id: "pf-cohort",
        field_type: "cohort",
        value: "2026",
      },
      {
        profile_field_id: "pf-term",
        field_type: "term",
        value: "2026 Fall",
      },
      {
        profile_field_id: "pf-course",
        field_type: "course",
        value: "COMP7101 | Applied Computing | aliases: AC",
      },
      {
        profile_field_id: "pf-residence",
        field_type: "residence",
        value: "Harbour Hall Block A",
      },
      {
        profile_field_id: "pf-visa",
        field_type: "immigration_status",
        value: "student_evisa_issued",
      },
      {
        profile_field_id: "pf-category",
        field_type: "student_category",
        value: "postgraduate_taught",
      },
    ],
  };
}

function assertRejected(mutator, code) {
  const input = makeModelInput();
  mutator(input);
  const before = structuredClone(input);
  const hashBefore = hashCanonicalJson(input);
  assert.throws(
    () => validatePhase2ModelInput(input),
    (error) =>
      error instanceof Phase2ModelInputValidationError && error.code === code,
  );
  assert.deepStrictEqual(input, before);
  assert.equal(hashCanonicalJson(input), hashBefore);
}

function hasKeyRecursively(value, prohibitedKey) {
  if (Array.isArray(value)) {
    return value.some((item) => hasKeyRecursively(item, prohibitedKey));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        key === prohibitedKey || hasKeyRecursively(child, prohibitedKey),
    );
  }
  return false;
}

test("Phase 2 validator exports the frozen multilingual, profile, and version contract", () => {
  assert.equal(
    PHASE2_MODEL_INPUT_PROJECTION_VERSION,
    "phase2-core-model-input-projection-v1",
  );
  assert.equal(PHASE2_MAX_MODEL_INPUT_UTF8_BYTES, 8_000);
  assert.deepEqual(PHASE2_ALLOWED_MESSAGE_LANGUAGES, [
    "en",
    "zh-Hant",
    "mixed",
    "zh-Hans",
  ]);
  assert.deepEqual(PHASE2_ALLOWED_PROFILE_FIELD_TYPES, [
    "school",
    "programme",
    "cohort",
    "term",
    "course",
    "residence",
    "immigration_status",
    "student_category",
  ]);
  assert.equal(Object.isFrozen(PHASE2_ALLOWED_MESSAGE_LANGUAGES), true);
  assert.equal(Object.isFrozen(PHASE2_ALLOWED_PROFILE_FIELD_TYPES), true);
});

test("Phase 2 validator accepts all allowed languages and eight unique profile types by identity", () => {
  for (const language of PHASE2_ALLOWED_MESSAGE_LANGUAGES) {
    const input = makeModelInput();
    input.message.language = language;
    const before = structuredClone(input);
    const hashBefore = hashCanonicalJson(input);
    assert.strictEqual(validatePhase2ModelInput(input), input);
    assert.deepStrictEqual(input, before);
    assert.equal(hashCanonicalJson(input), hashBefore);
  }
});

test("all frozen snapshot payloads are answer-free minimal Model Inputs", async () => {
  const developmentInputs = await loadPhase2DevelopmentInputs();
  assert.equal(developmentInputs.length, 16);

  for (const developmentInput of developmentInputs) {
    const { modelInput } = developmentInput;
    assert.deepEqual(Object.keys(modelInput), [
      "task_type",
      "target_language",
      "candidate_schema_version",
      "message",
      "profile_refs",
    ]);
    assert.equal(hasKeyRecursively(modelInput, "expected"), false);
    assert.equal(hasKeyRecursively(modelInput, "oracle"), false);
    assert.strictEqual(validatePhase2ModelInput(modelInput), modelInput);
    assert.throws(
      () => validatePhase2ModelInput(developmentInput),
      (error) =>
        error instanceof Phase2ModelInputValidationError &&
        error.code === "phase2_input_forbidden_field",
    );
  }
});

test("Phase 2 validator requires the exact minimal envelope", () => {
  assertRejected(
    (input) => {
      input.debug = true;
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      delete input.target_language;
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.task_type = "analyze_everything";
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.target_language = "en";
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.candidate_schema_version = "future-schema";
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.message.sent_at = "2026-08-29T12:00:00+08:00";
    },
    "phase2_input_invalid",
  );
});

test("Phase 2 validator explicitly rejects answers and Harness-owned fields at any depth", () => {
  assertRejected(
    (input) => {
      input.expected = {};
    },
    "phase2_input_forbidden_field",
  );
  assertRejected(
    (input) => {
      input.message.native_importance = { value: true };
    },
    "phase2_input_forbidden_field",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].source = "synthetic_user_confirmed";
    },
    "phase2_input_forbidden_field",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].home_section = "要处理";
    },
    "phase2_input_forbidden_field",
  );
  assertRejected(
    (input) => {
      input.message.calendar_candidate = null;
    },
    "phase2_input_forbidden_field",
  );
});

test("Phase 2 validator rejects secret-bearing keys and values", () => {
  assertRejected(
    (input) => {
      input.api_key = "synthetic-placeholder";
    },
    "phase2_input_secret_detected",
  );
  assertRejected(
    (input) => {
      input.message.body = "Authorization: Bearer synthetic-token-value";
    },
    "phase2_input_secret_detected",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].value = "DEEPSEEK_API_KEY";
    },
    "phase2_input_secret_detected",
  );
});

test("Phase 2 validator permits only private .invalid HTTPS network identifiers", async (t) => {
  const cases = [
    [
      "real HTTPS URL",
      "See https://example.com/item/1",
    ],
    [
      "HTTP synthetic URL",
      "See http://notices.harbour.invalid/item/1",
    ],
    [
      "protocol-relative URL",
      "See //notices.harbour.invalid/item/1",
    ],
    [
      "www URL",
      "See www.notices.harbour.invalid/item/1",
    ],
    [
      "mailto URL",
      "Email mailto:office@harbour.invalid",
    ],
    [
      "bare real domain",
      "See example.com/item/1",
    ],
    [
      "bare IPv4",
      "Use server 8.8.8.8",
    ],
    [
      "bare IPv6",
      "Use server [2001:4860:4860::8888]",
    ],
    [
      "localhost",
      "Open localhost:3000",
    ],
    [
      "Unicode IDN email",
      "Email user@例子.中国",
    ],
  ];

  for (const [name, body] of cases) {
    await t.test(name, () =>
      assertRejected(
        (input) => {
          input.message.body = body;
        },
        "phase2_input_network_invalid",
      ));
  }

  await t.test("real domain in profile value", () =>
    assertRejected(
      (input) => {
        input.profile_refs[0].value = "example.com";
      },
      "phase2_input_network_invalid",
    ));

  const synthetic = makeModelInput();
  synthetic.message.body =
    "See https://notices.harbour.invalid/item/1 or email office@harbour.invalid.";
  assert.strictEqual(validatePhase2ModelInput(synthetic), synthetic);
});

test("Phase 2 validator closes language and profile-ref bounds", () => {
  assertRejected(
    (input) => {
      input.message.language = "zh";
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs = [];
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs.push({
        profile_field_id: "pf-extra",
        field_type: "school",
        value: "另一所合成学校",
      });
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs[1].profile_field_id = input.profile_refs[0].profile_field_id;
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].profile_field_id = "invalid id";
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].field_type = "timezone";
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].value = "x".repeat(201);
    },
    "phase2_input_invalid",
  );
  assertRejected(
    (input) => {
      input.profile_refs[0].debug = true;
    },
    "phase2_input_invalid",
  );
});

test("Phase 2 validator enforces the frozen UTF-8 budget", () => {
  assertRejected(
    (input) => {
      input.message.body = "中".repeat(3_000);
    },
    "phase2_input_too_large",
  );
});

test("Phase 2 validator fails closed on cyclic and non-plain non-JSON input", () => {
  const cyclic = makeModelInput();
  cyclic.message.cycle = cyclic;
  assert.throws(
    () => validatePhase2ModelInput(cyclic),
    (error) =>
      error instanceof Phase2ModelInputValidationError &&
      error.code === "phase2_input_invalid",
  );

  const nonPlain = makeModelInput();
  nonPlain.message = new Date("2026-08-29T00:00:00Z");
  assert.throws(
    () => validatePhase2ModelInput(nonPlain),
    (error) =>
      error instanceof Phase2ModelInputValidationError &&
      error.code === "phase2_input_invalid",
  );
});
