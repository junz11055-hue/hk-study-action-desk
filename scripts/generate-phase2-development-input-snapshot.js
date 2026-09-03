import { writeFile } from "node:fs/promises";

import {
  PHASE2_DEVELOPMENT_SNAPSHOT_URL,
} from "../src/v2/phase2/development-input-loader.js";
import {
  buildPhase2DevelopmentInputSnapshot,
  readPhase2DevelopmentSourceFixtures,
} from "../src/v2/phase2/development-input-snapshot-builder.js";
import { hashUtf8 } from "../src/v2/validation/canonical-json.js";

function assertNoAnswerKeys(value, path = "$") {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:expected|oracle|answer_key|locked)$/iu.test(key)) {
      throw new Error(`answer-bearing key is forbidden at ${path}.${key}`);
    }
    assertNoAnswerKeys(child, `${path}.${key}`);
  }
}

const sourceFixtures = await readPhase2DevelopmentSourceFixtures();
const snapshot = buildPhase2DevelopmentInputSnapshot(sourceFixtures);
assertNoAnswerKeys(snapshot);

const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile(PHASE2_DEVELOPMENT_SNAPSHOT_URL, serialized, "utf8");

process.stdout.write(
  `${JSON.stringify({
    snapshotVersion: snapshot.snapshotVersion,
    caseCount: snapshot.cases.length,
    snapshotHash: snapshot.snapshotHash,
    snapshotFileHash: hashUtf8(serialized),
  })}\n`,
);
