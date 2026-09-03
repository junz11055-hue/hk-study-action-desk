import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CORE_DEVELOPMENT_FIXTURE_URL,
  CoreDevelopmentFixtureError,
  loadDevelopmentCoreFixture,
  projectDevelopmentCoreFixture,
} from "../../src/v2/fixtures/development-core-fixture-loader.js";

const fixtureSource = await readFile(CORE_DEVELOPMENT_FIXTURE_URL, "utf8");

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

function dev001Fixture() {
  return JSON.parse(fixtureSource).find((fixture) => fixture.case_id === "DEV001");
}

test("Core loader reads only base-development.json once and selects only DEV001", async () => {
  const opened = [];
  const result = await loadDevelopmentCoreFixture({
    caseId: "DEV001",
    readFileImpl: async (target, encoding) => {
      opened.push({ target: fileURLToPath(target), encoding });
      return fixtureSource;
    },
  });

  assert.deepEqual(opened, [
    {
      target: fileURLToPath(CORE_DEVELOPMENT_FIXTURE_URL),
      encoding: "utf8",
    },
  ]);
  assert.match(opened[0].target, /base-development\.json$/u);
  assert.doesNotMatch(opened[0].target, /locked|followups/iu);
  assert.equal(result.caseId, "DEV001");
  assert.equal(result.datasetSplit, "development");
  assert.deepEqual(Object.keys(result), [
    "caseId",
    "datasetSplit",
    "fixtureInput",
    "modelInput",
    "trustedProfileEvidence",
  ]);
  assert.equal(hasKeyRecursively(result, "expected"), false);
});

test("Core Model Input is exactly the approved minimal projection", async () => {
  const { fixtureInput, modelInput, trustedProfileEvidence } =
    await loadDevelopmentCoreFixture({
      caseId: "DEV001",
    });

  assert.deepEqual(Object.keys(modelInput), [
    "task_type",
    "target_language",
    "candidate_schema_version",
    "message",
    "profile_refs",
  ]);
  assert.equal(modelInput.task_type, "analyze_school_notification_core");
  assert.equal(modelInput.target_language, "zh-Hans");
  assert.equal(
    modelInput.candidate_schema_version,
    "notification-analysis-core-candidate-p1-v2",
  );
  assert.deepEqual(Object.keys(modelInput.message), [
    "subject",
    "language",
    "body",
  ]);
  assert.deepEqual(modelInput.message, {
    subject: "COMP7101 Assignment 1 deadline",
    language: "en",
    body: "COMP7101 students must submit Assignment 1 through https://learn.harbour.invalid/comp7101 by 5:00 pm HKT on 31 August 2026. Late submissions receive zero marks unless an approved extension exists.",
  });
  assert.deepEqual(modelInput.profile_refs, [
    {
      profile_field_id: "pf-dev001-course-comp7101",
      field_type: "course",
      value: "COMP7101 | Applied Computing",
    },
  ]);
  assert.deepEqual(fixtureInput, {
    message: modelInput.message,
    profile_refs: modelInput.profile_refs,
  });
  assert.notStrictEqual(fixtureInput.message, modelInput.message);
  assert.notStrictEqual(fixtureInput.profile_refs, modelInput.profile_refs);
  assert.deepEqual(trustedProfileEvidence, [
    {
      profile_field_id: "pf-dev001-course-comp7101",
      field_type: "course",
      value: "COMP7101 | Applied Computing",
      source: "synthetic_user_confirmed",
      confirmation_status: "confirmed",
      valid_until: "2026-12-31",
      course_status: "confirmed",
    },
  ]);

  const serialized = JSON.stringify(modelInput);
  for (const prohibited of [
    "expected",
    "repair_feedback",
    "native_importance",
    "security_facts",
    "provider_raw",
    "historical_items",
    "attachments",
    "aliases",
    "source",
    "confirmation_status",
    "valid_until",
  ]) {
    assert.equal(serialized.includes(`\"${prohibited}\"`), false, prohibited);
  }
  assert.ok(Buffer.byteLength(serialized, "utf8") <= 2_200);
});

test("Core loader rejects non-DEV001 before any fixture access", async () => {
  let reads = 0;
  await assert.rejects(
    loadDevelopmentCoreFixture({
      caseId: "DEV002",
      readFileImpl: async () => {
        reads += 1;
        return fixtureSource;
      },
    }),
    (error) =>
      error instanceof CoreDevelopmentFixtureError &&
      error.code === "fixture_not_allowed",
  );
  assert.equal(reads, 0);
});

test("Core projector rejects duplicate, non-synthetic, invalid-date, or untrusted variants", async (t) => {
  await t.test("duplicate DEV001", async () => {
    const source = dev001Fixture();
    await assert.rejects(
      loadDevelopmentCoreFixture({
        caseId: "DEV001",
        readFileImpl: async () => JSON.stringify([source, structuredClone(source)]),
      }),
      { code: "fixture_invalid" },
    );
  });

  await t.test("attachment branch", () => {
    const fixture = dev001Fixture();
    fixture.input.message.attachments.push({ attachment_id: "not-allowed" });
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("real URL", () => {
    const fixture = dev001Fixture();
    fixture.input.message.body = fixture.input.message.body.replace(
      "https://learn.harbour.invalid/comp7101",
      "https://example.com/comp7101",
    );
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  for (const [name, replacement] of [
    ["HTTP synthetic URL", "http://learn.harbour.invalid/comp7101"],
    ["protocol-relative URL", "//learn.harbour.invalid/comp7101"],
    ["www URL", "www.learn.harbour.invalid/comp7101"],
    ["bare real domain", "example.com/comp7101"],
    ["mailto URL", "mailto:office@harbour.invalid"],
    ["data URI", "data:text/plain,synthetic"],
  ]) {
    await t.test(name, () => {
      const fixture = dev001Fixture();
      fixture.input.message.body = fixture.input.message.body.replace(
        "https://learn.harbour.invalid/comp7101",
        replacement,
      );
      assert.throws(() => projectDevelopmentCoreFixture(fixture), {
        code: "fixture_invalid",
      });
    });
  }

  await t.test("unconfirmed course", () => {
    const fixture = dev001Fixture();
    fixture.input.profile.courses[0].confirmation_status = "unconfirmed";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("expired course", () => {
    const fixture = dev001Fixture();
    fixture.input.profile.courses[0].valid_until = "2026-08-28";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("invalid current date", () => {
    const fixture = dev001Fixture();
    fixture.harness_context.current_time_hkt = "2026-02-31T12:00:00+08:00";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("wrong Harness timezone", () => {
    const fixture = dev001Fixture();
    fixture.harness_context.timezone = "Asia/Shanghai";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("invalid profile date", () => {
    const fixture = dev001Fixture();
    fixture.input.profile.courses[0].valid_until = "2026-02-31";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("profile value exceeds final projection bound", () => {
    const fixture = dev001Fixture();
    const code = "C".repeat(80);
    fixture.input.profile.courses[0].code = code;
    fixture.input.profile.courses[0].name = "N".repeat(120);
    fixture.input.message.subject = `${code} deadline`;
    fixture.input.message.body = fixture.input.message.body.replace("COMP7101", code);
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("non-synthetic trusted source", () => {
    const fixture = dev001Fixture();
    fixture.input.profile.courses[0].source = "user_imported";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });

  await t.test("invalid profile field ID", () => {
    const fixture = dev001Fixture();
    fixture.input.profile.courses[0].profile_field_id = "invalid id with spaces";
    assert.throws(() => projectDevelopmentCoreFixture(fixture), {
      code: "fixture_invalid",
    });
  });
});
