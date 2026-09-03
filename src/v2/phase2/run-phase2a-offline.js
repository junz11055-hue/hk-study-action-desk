import { pathToFileURL } from "node:url";

import { runPhase2aOffline } from "./phase2a-offline-runner.js";

/** Fixed offline entry point. It accepts no CLI arguments and reads no config. */
export async function main(argv = process.argv.slice(2)) {
  return await runPhase2aOffline({ argv });
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const result = await main();
  process.exitCode = result.exitCode;
}
