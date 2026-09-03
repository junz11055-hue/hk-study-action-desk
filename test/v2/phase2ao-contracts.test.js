import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACTION_CARD_V02_CONTRACT_DESCRIPTOR,
  ACTION_CARD_V02_CONTRACT_HASH,
} from "../../src/v2/product/action-card-v02.js";
import { validatePhase2aoCandidate } from "../../src/v2/product/candidate-validation.js";
import {
  PHASE2AO_REQUEST_CONTRACT_DESCRIPTOR,
  PHASE2AO_REQUEST_CONTRACT_HASH,
  PHASE2AO_TASK_CONTRACT_DESCRIPTOR,
  PHASE2AO_TASK_CONTRACT_HASH,
  isRfc3339,
} from "../../src/v2/product/contracts.js";
import {
  DEV001_CAPTURED_REPLAY_CANDIDATE,
  DEV001_CAPTURED_REPLAY_CANDIDATE_HASH,
  DEV001_SYNTHETIC_MOCK_CANDIDATE,
} from "../../src/v2/product/fixtures/offline-candidates.js";
import {
  createPhase2aoOfflineAnalyzer,
  DEV001_SYNTHETIC_MOCK_CANDIDATE_HASH,
} from "../../src/v2/product/offline-analyzers.js";
import {
  PHASE2AO_CONTRACT_BUNDLE_DESCRIPTOR,
  PHASE2AO_CONTRACT_BUNDLE_HASH,
  PHASE2AO_HARNESS_POLICY_DESCRIPTOR,
  PHASE2AO_HARNESS_POLICY_HASH,
} from "../../src/v2/product/product-contract-manifest.js";
import {
  loadPhase2aoProductInput,
  PHASE2AO_MODEL_INPUT_HASH,
  PHASE2AO_PRODUCT_INPUT_FILE_HASH,
  PHASE2AO_PRODUCT_INPUT_HASH,
  PHASE2AO_PRODUCT_INPUT_URL,
} from "../../src/v2/product/product-input-loader.js";
import {
  hashCanonicalJson,
  hashUtf8,
} from "../../src/v2/validation/canonical-json.js";

const FROZEN_HASHES = Object.freeze({
  actionCard:
    "sha256:6a4be413cae22a99dda58d88aff6fbc9c714cff859aacf0e455164b02ce640bd",
  request:
    "sha256:49b946e77b9d0df9b3e8dc5ec362e1079656caa6927058b4230c48df77b53cc3",
  task: "sha256:6199ff27df0d48cbff1ade48a6d27296f621582a09ea3e3cd153f1d31c52eef5",
  harness:
    "sha256:5dc1bbb8099f6b58bccf984678877f6d20703341b5b0a4e224ed501d30cbca50",
  bundle:
    "sha256:0d026f8b2d69b5a744645aef8040aac1e0c42af40175cf31d140b3cc86a46ede",
  productInput:
    "sha256:ee18d0897a63f2f380ccf20df584815b9fa326b1ed3949dad65cbe6212d5405e",
  productInputFile:
    "sha256:ac6581a3a4b4183aea38c9797c29dc95118af03876fa42fbc9d630c4d0f4c8df",
  modelInput:
    "sha256:5f7e4d9e243e95a0f11ac7736f330252d6939ff845658cd91b04e88177888b5e",
  syntheticMock:
    "sha256:d584ef728eaf0eab32fe0735544551a390f2a5b0520c51175e11e80cd0594ded",
  capturedReplay:
    "sha256:c4d6c1812c15fb996519d499c887da573ca36ac7f152d76042b341c1066eaf3a",
});

test("Phase 2A-O public contracts and policy keep their frozen hashes", () => {
  assert.equal(ACTION_CARD_V02_CONTRACT_HASH, FROZEN_HASHES.actionCard);
  assert.equal(
    hashCanonicalJson(ACTION_CARD_V02_CONTRACT_DESCRIPTOR),
    FROZEN_HASHES.actionCard,
  );
  assert.equal(PHASE2AO_REQUEST_CONTRACT_HASH, FROZEN_HASHES.request);
  assert.equal(
    hashCanonicalJson(PHASE2AO_REQUEST_CONTRACT_DESCRIPTOR),
    FROZEN_HASHES.request,
  );
  assert.equal(PHASE2AO_TASK_CONTRACT_HASH, FROZEN_HASHES.task);
  assert.equal(
    hashCanonicalJson(PHASE2AO_TASK_CONTRACT_DESCRIPTOR),
    FROZEN_HASHES.task,
  );
  assert.equal(PHASE2AO_HARNESS_POLICY_HASH, FROZEN_HASHES.harness);
  assert.equal(
    hashCanonicalJson(PHASE2AO_HARNESS_POLICY_DESCRIPTOR),
    FROZEN_HASHES.harness,
  );
  assert.equal(PHASE2AO_CONTRACT_BUNDLE_HASH, FROZEN_HASHES.bundle);
  assert.equal(
    hashCanonicalJson(PHASE2AO_CONTRACT_BUNDLE_DESCRIPTOR),
    FROZEN_HASHES.bundle,
  );
});

test("the shared RFC3339 gate accepts real calendar dates and rejects normalized non-dates", () => {
  for (const timestamp of [
    "0000-01-01T00:00:00Z",
    "2024-02-29T23:59:59.1Z",
    "2026-08-29T12:00:00.123456+08:00",
  ]) {
    assert.equal(isRfc3339(timestamp), true, timestamp);
  }

  for (const timestamp of [
    "2026-00-01T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+08:60",
  ]) {
    assert.equal(isRfc3339(timestamp), false, timestamp);
  }
});

test("the approved Product Input preserves its exact file and canonical content hashes", async () => {
  const source = await readFile(PHASE2AO_PRODUCT_INPUT_URL, "utf8");
  const parsed = JSON.parse(source);
  const { snapshotHash, ...snapshotContent } = parsed;

  assert.equal(PHASE2AO_PRODUCT_INPUT_FILE_HASH, FROZEN_HASHES.productInputFile);
  assert.equal(hashUtf8(source), FROZEN_HASHES.productInputFile);
  assert.equal(PHASE2AO_PRODUCT_INPUT_HASH, FROZEN_HASHES.productInput);
  assert.equal(snapshotHash, FROZEN_HASHES.productInput);
  assert.equal(hashCanonicalJson(snapshotContent), FROZEN_HASHES.productInput);
  assert.equal(PHASE2AO_MODEL_INPUT_HASH, FROZEN_HASHES.modelInput);
  assert.equal(parsed.modelInputHash, FROZEN_HASHES.modelInput);
  assert.equal(hashCanonicalJson(parsed.modelInput), FROZEN_HASHES.modelInput);

  const loaded = await loadPhase2aoProductInput({ caseId: "DEV001" });
  assert.deepEqual(loaded, parsed);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.modelInput), true);
});

test("Mock and Replay Candidates cross the v2 gate by identity and without hash drift", async (t) => {
  const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
  const cases = [
    {
      mode: "synthetic_mock",
      fixture: DEV001_SYNTHETIC_MOCK_CANDIDATE,
      hash: FROZEN_HASHES.syntheticMock,
      exportedHash: DEV001_SYNTHETIC_MOCK_CANDIDATE_HASH,
    },
    {
      mode: "captured_replay",
      fixture: DEV001_CAPTURED_REPLAY_CANDIDATE,
      hash: FROZEN_HASHES.capturedReplay,
      exportedHash: DEV001_CAPTURED_REPLAY_CANDIDATE_HASH,
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.mode, async () => {
      assert.equal(fixtureCase.exportedHash, fixtureCase.hash);
      assert.equal(hashCanonicalJson(fixtureCase.fixture), fixtureCase.hash);

      const analyzer = createPhase2aoOfflineAnalyzer({
        executionMode: fixtureCase.mode,
      });
      const result = await analyzer.analyze({
        caseId: "DEV001",
        modelInput: productInput.modelInput,
      });
      const before = hashCanonicalJson(result.candidate);
      const accepted = validatePhase2aoCandidate(
        result.candidate,
        productInput.modelInput,
      );

      assert.notEqual(result.candidate, fixtureCase.fixture);
      assert.equal(result.candidateFixtureHash, fixtureCase.hash);
      assert.equal(before, fixtureCase.hash);
      assert.equal(accepted.candidate, result.candidate);
      assert.equal(accepted.candidateHash, fixtureCase.hash);
      assert.equal(hashCanonicalJson(result.candidate), before);
      assert.equal(analyzer.callCount, 1);
    });
  }
});

test("the Candidate v2 gate rejects but never repairs a malformed Candidate", async () => {
  const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
  const analyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const { candidate } = await analyzer.analyze({
    caseId: "DEV001",
    modelInput: productInput.modelInput,
  });
  candidate.applicability.profile_field_ids = ["pf-not-approved"];
  const before = hashCanonicalJson(candidate);

  assert.throws(
    () => validatePhase2aoCandidate(candidate, productInput.modelInput),
    { code: "candidate_invalid" },
  );
  assert.equal(hashCanonicalJson(candidate), before);
  assert.deepEqual(candidate.applicability.profile_field_ids, [
    "pf-not-approved",
  ]);
});
