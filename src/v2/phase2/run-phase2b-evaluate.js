import { pathToFileURL } from "node:url";

import { runPhase2bEvaluation } from "./phase2b-evaluation-runner.js";

function output(stream, value) {
  stream?.write?.(`${JSON.stringify(value)}\n`);
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  if (!Array.isArray(argv) || argv.length !== 0) {
    output(stderr, { error: { code: "invalid_cli_input" }, exit_code: 2 });
    return { exitCode: 2 };
  }
  try {
    const result = await (options.runImpl ?? runPhase2bEvaluation)(options);
    output(stdout, {
      status: result.record.status,
      run_id: result.runId,
      evaluation_record_path: result.recordPath,
      exit_code: result.exitCode,
    });
    return result;
  } catch (error) {
    const code = typeof error?.code === "string"
      ? error.code
      : "phase2b_evaluation_failed";
    output(stderr, { error: { code }, exit_code: 6 });
    return { exitCode: 6 };
  }
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const result = await main();
  process.exitCode = result.exitCode;
}
