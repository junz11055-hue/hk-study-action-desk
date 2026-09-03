import { readFile, writeFile } from "node:fs/promises";

import { buildPhase2rSourceContextSnapshot } from "../src/v2/phase2r/phase2r-source-context-builder.js";
import { hashUtf8 } from "../src/v2/validation/canonical-json.js";

const sourceUrl = new URL(
  "../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const outputUrl = new URL(
  "../docs/fixtures/prd-v0.2/phase2r-source-context-v1.json",
  import.meta.url,
);

const fixtures = JSON.parse(await readFile(sourceUrl, "utf8"));
const snapshot = buildPhase2rSourceContextSnapshot(fixtures);
const output = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile(outputUrl, output, { encoding: "utf8", flag: "w" });
process.stdout.write(
  `${JSON.stringify({
    snapshot_hash: snapshot.snapshotHash,
    file_hash: hashUtf8(output),
  })}\n`,
);
