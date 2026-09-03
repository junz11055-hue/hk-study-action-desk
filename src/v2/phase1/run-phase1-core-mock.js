import { pathToFileURL } from "node:url";

import { createPhase1CoreMockModelClient } from "../model/phase1-core-model-adapter.js";
import { runPhase1Core } from "./phase1-core-runner.js";

/** Fixed offline entry point. It never loads config, .env, or a real provider. */
export async function main(argv = process.argv.slice(2), options = {}) {
  const modelClient = createPhase1CoreMockModelClient({
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.candidateFactory ? { candidateFactory: options.candidateFactory } : {}),
  });
  return await runPhase1Core({
    executionMode: "mock",
    argv,
    modelClient,
    ...(options.runsDirectory ? { runsDirectory: options.runsDirectory } : {}),
    ...(options.readFileImpl ? { readFileImpl: options.readFileImpl } : {}),
    ...(options.writeRecordImpl ? { writeRecordImpl: options.writeRecordImpl } : {}),
    ...(options.payloadGuard ? { payloadGuard: options.payloadGuard } : {}),
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
