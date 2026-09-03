import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePhase2rbEnv,
  readPhase2rbEnvFile,
} from "../phase2rb/phase2rb-deepseek-config.js";
import {
  PHASE2AL_BASE_URL,
  PHASE2AL_MODEL,
  PHASE2AL_TIMEOUT_MS,
} from "./phase2al-run-contract.js";

export const PHASE2AL_REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export class Phase2alDeepSeekConfigurationError extends Error {
  constructor(options = {}) {
    super("Phase 2A-L DeepSeek configuration is unavailable or drifted.", options);
    this.name = "Phase2alDeepSeekConfigurationError";
    this.code = "model_configuration_invalid";
  }
}

function fail(cause) {
  throw new Phase2alDeepSeekConfigurationError(
    cause === undefined ? {} : { cause },
  );
}

/** This function may only be called after marker and request intent persist. */
export async function loadPhase2alDeepSeekConfig({
  env = process.env,
  repositoryRoot = PHASE2AL_REPOSITORY_ROOT,
  readEnvFileImpl = readPhase2rbEnvFile,
  parseEnvImpl = parsePhase2rbEnv,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const envPath = path.resolve(root, ".env");
  if (path.dirname(envPath) !== root) fail();

  let fileValues = Object.freeze(Object.create(null));
  try {
    const source = await readEnvFileImpl(envPath);
    if (source !== null) fileValues = parseEnvImpl(source);
  } catch (error) {
    fail(error);
  }
  if (!fileValues || typeof fileValues !== "object" || Array.isArray(fileValues)) {
    fail();
  }

  const configured = (name) =>
    typeof env?.[name] === "string" ? env[name] : fileValues[name];
  const apiKey = configured("DEEPSEEK_API_KEY");
  const model = configured("DEEPSEEK_MODEL")?.trim() || PHASE2AL_MODEL;
  const baseUrl = configured("DEEPSEEK_BASE_URL")?.trim() || PHASE2AL_BASE_URL;
  const timeoutSource = configured("DEEPSEEK_TIMEOUT_MS")?.trim();
  const timeoutMs = timeoutSource ? Number(timeoutSource) : PHASE2AL_TIMEOUT_MS;
  if (
    typeof apiKey !== "string" ||
    apiKey.length < 1 ||
    apiKey.length > 4_096 ||
    /\s/u.test(apiKey) ||
    model !== PHASE2AL_MODEL ||
    baseUrl !== PHASE2AL_BASE_URL ||
    timeoutMs !== PHASE2AL_TIMEOUT_MS
  ) {
    fail();
  }
  return Object.freeze({ apiKey, model, baseUrl, timeoutMs });
}
