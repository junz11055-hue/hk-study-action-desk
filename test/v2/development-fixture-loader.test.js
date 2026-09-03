import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEVELOPMENT_FIXTURE_URL,
  DevelopmentFixtureError,
  loadDevelopmentFixture,
  projectDevelopmentFixture,
} from "../../src/v2/fixtures/development-fixture-loader.js";

const fixtureSource = await readFile(DEVELOPMENT_FIXTURE_URL, "utf8");

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

test("loader opens only base-development.json once and projects only DEV001", async () => {
  const opened = [];
  const result = await loadDevelopmentFixture({
    caseId: "DEV001",
    readFileImpl: async (target, encoding) => {
      opened.push({ target: fileURLToPath(target), encoding });
      return fixtureSource;
    },
  });

  assert.deepEqual(opened, [
    {
      target: fileURLToPath(DEVELOPMENT_FIXTURE_URL),
      encoding: "utf8",
    },
  ]);
  assert.equal(opened[0].target.endsWith("/base-development.json"), true);
  assert.equal(opened[0].target.includes("locked"), false);
  assert.equal(opened[0].target.includes("followups"), false);

  assert.equal(result.caseId, "DEV001");
  assert.equal(result.datasetSplit, "development");
  assert.deepEqual(Object.keys(result.fixtureInput).sort(), [
    "harness_context",
    "input",
    "source_message_id",
    "thread_id",
  ]);
  assert.deepEqual(Object.keys(result.fixtureInput.input).sort(), [
    "message",
    "profile",
  ]);
  assert.deepEqual(Object.keys(result.fixtureInput.harness_context).sort(), [
    "current_time_hkt",
    "historical_items",
    "timezone",
  ]);
  assert.equal(hasKeyRecursively(result.fixtureInput, "expected"), false);
  assert.equal(hasKeyRecursively(result.modelInput, "expected"), false);
});

test("model input is the exact trusted constants plus seven-path projection", async () => {
  const { modelInput } = await loadDevelopmentFixture({ caseId: "DEV001" });

  assert.deepEqual(Object.keys(modelInput), [
    "task_type",
    "target_language",
    "candidate_schema_version",
    "repair_feedback",
    "current_time_hkt",
    "timezone",
    "message_context",
    "profile",
    "message",
    "historical_items",
  ]);
  assert.equal(modelInput.task_type, "analyze_school_notification_candidate");
  assert.equal(modelInput.target_language, "zh-Hans");
  assert.equal(
    modelInput.candidate_schema_version,
    "notification-analysis-candidate-p1-v1",
  );
  assert.equal(modelInput.repair_feedback, null);
  assert.equal(modelInput.current_time_hkt, "2026-08-29T12:00:00+08:00");
  assert.equal(modelInput.timezone, "Asia/Hong_Kong");
  assert.deepEqual(modelInput.message_context, {
    thread_id: "DEV-THREAD-PAIR-01",
    source_message_id: "DEV-SRC-PAIR-01",
  });
  assert.equal(modelInput.profile.timezone.value, modelInput.timezone);
  assert.equal(modelInput.message.notification_id, "DEV-NOTIF-PAIR-01");
  assert.deepEqual(modelInput.historical_items, []);
  assert.equal(JSON.stringify(modelInput).includes(".invalid"), true);
});

test("non-DEV001 requests fail before any fixture file access", async () => {
  let reads = 0;
  await assert.rejects(
    loadDevelopmentFixture({
      caseId: "DEV002",
      readFileImpl: async () => {
        reads += 1;
        return fixtureSource;
      },
    }),
    (error) =>
      error instanceof DevelopmentFixtureError &&
      error.code === "fixture_not_allowed",
  );
  assert.equal(reads, 0);
});

test("loader rejects duplicate, inconsistent, or non-synthetic DEV001 data", async () => {
  const base = JSON.parse(fixtureSource);
  const dev001 = base.find((fixture) => fixture.case_id === "DEV001");

  const duplicate = [dev001, structuredClone(dev001)];
  await assert.rejects(
    loadDevelopmentFixture({
      caseId: "DEV001",
      readFileImpl: async () => JSON.stringify(duplicate),
    }),
    { code: "fixture_invalid" },
  );

  const wrongTimezone = structuredClone(dev001);
  wrongTimezone.input.profile.timezone.value = "UTC";
  await assert.rejects(
    loadDevelopmentFixture({
      caseId: "DEV001",
      readFileImpl: async () => JSON.stringify([wrongTimezone]),
    }),
    { code: "fixture_invalid" },
  );

  const historyInjected = structuredClone(dev001);
  historyInjected.harness_context.historical_items.push({ id: "not-allowed" });
  await assert.rejects(
    loadDevelopmentFixture({
      caseId: "DEV001",
      readFileImpl: async () => JSON.stringify([historyInjected]),
    }),
    { code: "fixture_invalid" },
  );

  const realDomain = structuredClone(dev001);
  realDomain.input.message.links[0].resolved_url = "https://example.com/action";
  await assert.rejects(
    loadDevelopmentFixture({
      caseId: "DEV001",
      readFileImpl: async () => JSON.stringify([realDomain]),
    }),
    { code: "fixture_invalid" },
  );
});
test("repair feedback is narrow, bounded, and cannot carry the message body", () => {
  const dev001 = JSON.parse(fixtureSource).find(
    (fixture) => fixture.case_id === "DEV001",
  );
  const projected = projectDevelopmentFixture(dev001, {
    repairFeedback: {
      error_code: "candidate_schema_invalid",
      json_paths: ["/claims/0/text"],
      message: "A required field has the wrong type.",
    },
  });
  assert.deepEqual(projected.repair_feedback, {
    error_code: "candidate_schema_invalid",
    json_paths: ["/claims/0/text"],
    message: "A required field has the wrong type.",
  });

  assert.throws(
    () =>
      projectDevelopmentFixture(dev001, {
        repairFeedback: {
          error_code: "candidate_schema_invalid",
          json_paths: ["/claims"],
          message: dev001.input.message.body,
        },
      }),
    { code: "fixture_invalid" },
  );
  assert.throws(
    () =>
      projectDevelopmentFixture(dev001, {
        repairFeedback: {
          error_code: "candidate_forbidden_field",
          json_paths: ["/home_section"],
          message: "Remove it.",
        },
      }),
    { code: "fixture_invalid" },
  );
});
