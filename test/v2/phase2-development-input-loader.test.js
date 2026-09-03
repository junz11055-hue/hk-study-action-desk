import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as loaderModule from "../../src/v2/phase2/development-input-loader.js";
import {
  PHASE2_DATASET_SPLIT,
  PHASE2_DEVELOPMENT_CASE_IDS,
  PHASE2_DEVELOPMENT_FIXTURE_URL,
  PHASE2_DEVELOPMENT_SNAPSHOT_FILE_HASH,
  PHASE2_DEVELOPMENT_SNAPSHOT_HASH,
  PHASE2_DEVELOPMENT_SNAPSHOT_URL,
  PHASE2_DEVELOPMENT_SNAPSHOT_VERSION,
  PHASE2_MODEL_INPUT_PROJECTION_VERSION,
  Phase2DevelopmentInputError,
  loadPhase2DevelopmentInput,
  loadPhase2DevelopmentInputs,
} from "../../src/v2/phase2/development-input-loader.js";
import {
  PHASE2_DEVELOPMENT_SOURCE_URL,
  buildPhase2DevelopmentInputSnapshot,
  projectPhase2DevelopmentInput,
} from "../../src/v2/phase2/development-input-snapshot-builder.js";
import {
  hashCanonicalJson,
  hashUtf8,
} from "../../src/v2/validation/canonical-json.js";

const snapshotSource = await readFile(PHASE2_DEVELOPMENT_SNAPSHOT_URL, "utf8");
const frozenSnapshot = JSON.parse(snapshotSource);
const sourceFixtureText = await readFile(PHASE2_DEVELOPMENT_SOURCE_URL, "utf8");
const allSourceFixtures = JSON.parse(sourceFixtureText);

function sourceFixtureFor(caseId) {
  return structuredClone(
    allSourceFixtures.find((fixture) => fixture.case_id === caseId),
  );
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

test("Phase 2 loader freezes the exact answer-free snapshot contract", () => {
  assert.deepEqual(PHASE2_DEVELOPMENT_CASE_IDS, [
    "DEV001",
    "DEV003",
    "DEV004",
    "DEV005",
    "DEV006",
    "DEV007",
    "DEV008",
    "DEV010",
    "DEV017",
    "DEV018",
    "DEV019",
    "DEV020",
    "DEV022",
    "DEV023",
    "DEV024",
    "DEV025",
  ]);
  assert.equal(Object.isFrozen(PHASE2_DEVELOPMENT_CASE_IDS), true);
  assert.equal(PHASE2_DATASET_SPLIT, "development");
  assert.equal(
    PHASE2_MODEL_INPUT_PROJECTION_VERSION,
    "phase2-core-model-input-projection-v1",
  );
  assert.equal(
    PHASE2_DEVELOPMENT_SNAPSHOT_VERSION,
    "phase2-development-model-input-snapshot-v1",
  );
  assert.equal(
    PHASE2_DEVELOPMENT_FIXTURE_URL.href,
    PHASE2_DEVELOPMENT_SNAPSHOT_URL.href,
  );
  const snapshotPath = fileURLToPath(PHASE2_DEVELOPMENT_SNAPSHOT_URL);
  assert.match(snapshotPath, /phase2-development-inputs-v1\.json$/u);
  assert.doesNotMatch(
    snapshotPath,
    /base-development|locked|followups|mutations|state-transitions/iu,
  );
  assert.equal("projectPhase2DevelopmentInput" in loaderModule, false);
});

test("checked-in snapshot is deterministic, answer-free, versioned, and hash-pinned", () => {
  assert.deepEqual(Object.keys(frozenSnapshot), [
    "snapshotVersion",
    "datasetSplit",
    "projectionVersion",
    "caseIds",
    "cases",
    "snapshotHash",
  ]);
  assert.equal(frozenSnapshot.snapshotVersion, PHASE2_DEVELOPMENT_SNAPSHOT_VERSION);
  assert.equal(frozenSnapshot.snapshotHash, PHASE2_DEVELOPMENT_SNAPSHOT_HASH);
  assert.equal(hashUtf8(snapshotSource), PHASE2_DEVELOPMENT_SNAPSHOT_FILE_HASH);
  assert.equal(frozenSnapshot.cases.length, 16);
  assert.equal(hasKeyRecursively(frozenSnapshot, "expected"), false);
  assert.equal(hasKeyRecursively(frozenSnapshot, "oracle"), false);
  assert.deepEqual(
    buildPhase2DevelopmentInputSnapshot(allSourceFixtures),
    frozenSnapshot,
  );
});

test("full loader opens only the snapshot once and returns 16 answer-free inputs", async () => {
  const opened = [];
  const results = await loadPhase2DevelopmentInputs({
    readFileImpl: async (target, encoding) => {
      opened.push({ target: fileURLToPath(target), encoding });
      return snapshotSource;
    },
  });

  assert.deepEqual(opened, [
    {
      target: fileURLToPath(PHASE2_DEVELOPMENT_SNAPSHOT_URL),
      encoding: "utf8",
    },
  ]);
  assert.deepEqual(
    results.map(({ caseId }) => caseId),
    PHASE2_DEVELOPMENT_CASE_IDS,
  );
  assert.equal(results.length, 16);
  assert.equal(Object.isFrozen(results), true);

  const languageCounts = Object.fromEntries(
    ["en", "zh-Hant", "mixed", "zh-Hans"].map((language) => [
      language,
      results.filter((item) => item.modelInput.message.language === language)
        .length,
    ]),
  );
  assert.deepEqual(languageCounts, {
    en: 7,
    "zh-Hant": 6,
    mixed: 2,
    "zh-Hans": 1,
  });

  for (const result of results) {
    assert.deepEqual(Object.keys(result), [
      "caseId",
      "datasetSplit",
      "projectionVersion",
      "fixtureInput",
      "modelInput",
      "trustedProfileEvidence",
      "modelInputHash",
    ]);
    assert.equal(result.datasetSplit, "development");
    assert.equal(
      result.projectionVersion,
      "phase2-core-model-input-projection-v1",
    );
    assert.match(result.modelInputHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(result.modelInputHash, hashCanonicalJson(result.modelInput));
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.modelInput), true);
    assert.equal(Object.isFrozen(result.trustedProfileEvidence), true);
    assert.notStrictEqual(result.fixtureInput.message, result.modelInput.message);
    assert.notStrictEqual(
      result.fixtureInput.profile_refs,
      result.modelInput.profile_refs,
    );
    assert.deepEqual(result.fixtureInput, {
      message: result.modelInput.message,
      profile_refs: result.modelInput.profile_refs,
    });
    assert.equal(hasKeyRecursively(result, "expected"), false);
    assert.ok(result.modelInput.profile_refs.length >= 4);
    assert.ok(result.modelInput.profile_refs.length <= 8);
  }
});

test("single loader exposes deterministic programme and course alias facts", async () => {
  const programme = await loadPhase2DevelopmentInput({ caseId: "DEV023" });
  assert.deepEqual(
    programme.modelInput.profile_refs.find(
      (ref) => ref.profile_field_id === "pf-dev023-project",
    ),
    {
      profile_field_id: "pf-dev023-project",
      field_type: "programme",
      value:
        "Master of Science in Artificial Intelligence Systems | aliases: MAIS, MSc AI Systems",
    },
  );

  const course = await loadPhase2DevelopmentInput({ caseId: "DEV001" });
  assert.deepEqual(course.modelInput.profile_refs, [
    {
      profile_field_id: "pf-dev001-school",
      field_type: "school",
      value: "港湾大学",
    },
    {
      profile_field_id: "pf-dev001-project",
      field_type: "programme",
      value: "MSc Computing",
    },
    {
      profile_field_id: "pf-dev001-cohort",
      field_type: "cohort",
      value: "2026",
    },
    {
      profile_field_id: "pf-dev001-term",
      field_type: "term",
      value: "2026 Fall",
    },
    {
      profile_field_id: "pf-dev001-course-comp7101",
      field_type: "course",
      value: "COMP7101 | Applied Computing | aliases: AC",
    },
  ]);
  assert.deepEqual(course.trustedProfileEvidence.at(-1), {
    profile_field_id: "pf-dev001-course-comp7101",
    field_type: "course",
    value: "COMP7101 | Applied Computing | aliases: AC",
    source: "synthetic_user_confirmed",
    confirmation_status: "confirmed",
    valid_until: "2026-12-31",
    course_status: "confirmed",
  });
});

test("build-time projector only includes currently valid confirmed profile facts", () => {
  const fixture = sourceFixtureFor("DEV001");
  fixture.input.profile.school.confirmation_status = "unconfirmed";
  fixture.input.profile.term.valid_until = "2026-08-28";
  fixture.input.profile.courses[0].status = "removed";

  const modelInput = projectPhase2DevelopmentInput(fixture);
  assert.deepEqual(modelInput.profile_refs, [
    {
      profile_field_id: "pf-dev001-project",
      field_type: "programme",
      value: "MSc Computing",
    },
    {
      profile_field_id: "pf-dev001-cohort",
      field_type: "cohort",
      value: "2026",
    },
  ]);
});

test("build-time projection is deterministic, immutable, and source-preserving", () => {
  const fixture = sourceFixtureFor("DEV019");
  const fixtureBefore = structuredClone(fixture);
  const first = projectPhase2DevelopmentInput(fixture);
  const second = projectPhase2DevelopmentInput(fixture);

  assert.deepStrictEqual(fixture, fixtureBefore);
  assert.deepEqual(first, second);
  assert.equal(hashCanonicalJson(first), hashCanonicalJson(second));
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first.profile_refs.at(-1), {
    profile_field_id: "pf-dev019-visa",
    field_type: "immigration_status",
    value: "student_evisa_issued",
  });
  assert.throws(() => {
    first.message.subject = "mutated";
  }, TypeError);
});

test("single loader rejects a non-whitelisted ID before snapshot access", async () => {
  let reads = 0;
  await assert.rejects(
    loadPhase2DevelopmentInput({
      caseId: "DEV002",
      readFileImpl: async () => {
        reads += 1;
        return snapshotSource;
      },
    }),
    (error) =>
      error instanceof Phase2DevelopmentInputError &&
      error.code === "fixture_not_allowed",
  );
  assert.equal(reads, 0);
});

test("snapshot loader rejects every body, hash, field, duplicate, and order mutation", async (t) => {
  const mutations = [
    [
      "message body",
      (snapshot) => {
        snapshot.cases[0].modelInput.message.body += " changed";
      },
    ],
    [
      "model input hash",
      (snapshot) => {
        snapshot.cases[0].modelInputHash = `sha256:${"0".repeat(64)}`;
      },
    ],
    [
      "unknown root field",
      (snapshot) => {
        snapshot.debug = true;
      },
    ],
    [
      "duplicate case",
      (snapshot) => {
        snapshot.cases[1] = structuredClone(snapshot.cases[0]);
      },
    ],
    [
      "Case ID order",
      (snapshot) => {
        snapshot.caseIds.reverse();
      },
    ],
    [
      "case order",
      (snapshot) => {
        snapshot.cases.reverse();
      },
    ],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const changed = structuredClone(frozenSnapshot);
      mutate(changed);
      await assert.rejects(
        loadPhase2DevelopmentInputs({
          readFileImpl: async () => `${JSON.stringify(changed, null, 2)}\n`,
        }),
        { code: "snapshot_integrity_error" },
      );
    });
  }

  await t.test("duplicate JSON property with identical value", async () => {
    const changed = snapshotSource.replace(
      /\{\n  "snapshotVersion":/u,
      `{\n  "snapshotVersion": ${JSON.stringify(
        PHASE2_DEVELOPMENT_SNAPSHOT_VERSION,
      )},\n  "snapshotVersion":`,
    );
    await assert.rejects(
      loadPhase2DevelopmentInputs({ readFileImpl: async () => changed }),
      { code: "snapshot_integrity_error" },
    );
  });

  await t.test("whitespace-only file mutation", async () => {
    await assert.rejects(
      loadPhase2DevelopmentInputs({
        readFileImpl: async () => `${snapshotSource}\n`,
      }),
      { code: "snapshot_integrity_error" },
    );
  });
});

test("build-time builder fails closed on missing and duplicate source cases", async (t) => {
  await t.test("missing case", () => {
    const fixtures = allSourceFixtures.filter(
      (fixture) => fixture.case_id !== "DEV025",
    );
    assert.throws(() => buildPhase2DevelopmentInputSnapshot(fixtures), {
      code: "fixture_invalid",
    });
  });

  await t.test("duplicate case", () => {
    const duplicate = sourceFixtureFor("DEV001");
    assert.throws(
      () =>
        buildPhase2DevelopmentInputSnapshot([
          ...allSourceFixtures,
          duplicate,
        ]),
      { code: "fixture_invalid" },
    );
  });
});

test("build-time projector rejects attachment, trust, alias, ID, and URL violations", async (t) => {
  const cases = [
    [
      "attachment",
      (fixture) => {
        fixture.input.message.attachments.push({ attachment_id: "synthetic" });
      },
    ],
    [
      "non-synthetic source",
      (fixture) => {
        fixture.input.profile.school.source = "user_imported";
      },
    ],
    [
      "invalid date",
      (fixture) => {
        fixture.input.profile.cohort.valid_until = "2026-02-31";
      },
    ],
    [
      "duplicate projected ID",
      (fixture) => {
        fixture.input.profile.project.profile_field_id =
          fixture.input.profile.school.profile_field_id;
      },
    ],
    [
      "oversized alias projection",
      (fixture) => {
        fixture.input.profile.project.value = "P".repeat(160);
        fixture.input.profile.project.aliases = ["A".repeat(80)];
      },
    ],
    [
      "real URL",
      (fixture) => {
        fixture.input.message.body = fixture.input.message.body.replace(
          "https://learn.harbour.invalid/comp7101",
          "https://example.com/comp7101",
        );
      },
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const fixture = sourceFixtureFor("DEV001");
      mutate(fixture);
      assert.throws(() => projectPhase2DevelopmentInput(fixture), {
        code: "fixture_invalid",
      });
    });
  }
});
