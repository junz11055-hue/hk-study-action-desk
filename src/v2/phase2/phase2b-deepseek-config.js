import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PHASE2B_DEEPSEEK_BASE_URL,
  PHASE2B_DEEPSEEK_MODEL,
  PHASE2B_TIMEOUT_MS,
} from "../model/phase2-core-model-adapter.js";

export const PHASE2B_REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export class Phase2bDeepSeekConfigurationError extends Error {
  constructor() {
    super("Phase 2B DeepSeek configuration is unavailable or not frozen.");
    this.name = "Phase2bDeepSeekConfigurationError";
    this.code = "model_configuration_invalid";
  }
}

/** Load only the approved DeepSeek fields after the one-shot marker exists. */
export async function loadPhase2bDeepSeekConfig({
  env = process.env,
  loadEnvFileImpl = process.loadEnvFile,
  repositoryRoot = PHASE2B_REPOSITORY_ROOT,
} = {}) {
  try {
    loadEnvFileImpl(path.join(repositoryRoot, ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Phase2bDeepSeekConfigurationError();
  }

  const apiKey = env.DEEPSEEK_API_KEY;
  const model = env.DEEPSEEK_MODEL?.trim() || PHASE2B_DEEPSEEK_MODEL;
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || PHASE2B_DEEPSEEK_BASE_URL;
  const timeoutText = env.DEEPSEEK_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutText ? Number(timeoutText) : PHASE2B_TIMEOUT_MS;
  if (
    typeof apiKey !== "string" ||
    apiKey.length < 1 ||
    model !== PHASE2B_DEEPSEEK_MODEL ||
    baseUrl !== PHASE2B_DEEPSEEK_BASE_URL ||
    timeoutMs !== PHASE2B_TIMEOUT_MS
  ) {
    throw new Phase2bDeepSeekConfigurationError();
  }
  return Object.freeze({ apiKey, model, baseUrl, timeoutMs });
}
