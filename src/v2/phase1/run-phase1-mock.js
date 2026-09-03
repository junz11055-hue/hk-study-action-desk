import { pathToFileURL } from "node:url";

import { createPhase1MockModelClient } from "../model/phase1-model-adapter.js";
import { runPhase1 } from "./phase1-runner.js";

export async function main(argv = process.argv.slice(2), options = {}) {
  const modelClient = createPhase1MockModelClient({
    ...(options.clock ? { clock: options.clock } : {}),
  });
  return await runPhase1({
    executionMode: "mock",
    argv,
    modelClient,
    ...(options.runsDirectory ? { runsDirectory: options.runsDirectory } : {}),
    ...(options.readFileImpl ? { readFileImpl: options.readFileImpl } : {}),
    ...(options.writeRecordImpl ? { writeRecordImpl: options.writeRecordImpl } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
  });
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const result = await main();
  process.exitCode = result.exitCode;
}
