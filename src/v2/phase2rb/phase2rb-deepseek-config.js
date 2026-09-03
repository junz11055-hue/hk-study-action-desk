import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PHASE2RB_BASE_URL,
  PHASE2RB_MODEL,
  PHASE2RB_TIMEOUT_MS,
} from "./phase2rb-run-contract.js";

export const PHASE2RB_REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);
export const PHASE2RB_MAX_ENV_FILE_BYTES = 65_536;

export class Phase2rbDeepSeekConfigurationError extends Error {
  constructor() {
    super("Phase 2R-B DeepSeek configuration is unavailable or not frozen.");
    this.name = "Phase2rbDeepSeekConfigurationError";
    this.code = "model_configuration_invalid";
  }
}

function configurationError() {
  return new Phase2rbDeepSeekConfigurationError();
}

function decodeEnvValue(source) {
  const value = source.trim();
  if (value.length === 0) return "";
  if (value.startsWith("'") || value.startsWith('"')) {
    const quote = value[0];
    if (value.length < 2 || value.at(-1) !== quote) throw configurationError();
    const inner = value.slice(1, -1);
    if (quote === "'") return inner;
    return inner.replace(/\\([\\"nrt])/gu, (_, escaped) => {
      if (escaped === "n") return "\n";
      if (escaped === "r") return "\r";
      if (escaped === "t") return "\t";
      return escaped;
    });
  }
  const comment = /\s+#/u.exec(value);
  return (comment ? value.slice(0, comment.index) : value).trim();
}

export function parsePhase2rbEnv(source) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > PHASE2RB_MAX_ENV_FILE_BYTES ||
    /\u0000/u.test(source)
  ) {
    throw configurationError();
  }
  const result = Object.create(null);
  const seen = new Set();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
      line,
    );
    if (!match || seen.has(match[1])) throw configurationError();
    seen.add(match[1]);
    const value = decodeEnvValue(match[2]);
    if (value.length > 16_384 || /[\u0000\u007f-\u009f]/u.test(value)) {
      throw configurationError();
    }
    result[match[1]] = value;
  }
  return Object.freeze(result);
}

export async function readPhase2rbEnvFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  let handle;
  try {
    const pathInfo = await lstat(resolvedPath);
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      (pathInfo.mode & 0o777) !== 0o600 ||
      pathInfo.size < 0 ||
      pathInfo.size > PHASE2RB_MAX_ENV_FILE_BYTES
    ) {
      throw configurationError();
    }
    handle = await open(
      resolvedPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const openedInfo = await handle.stat();
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== pathInfo.dev ||
      openedInfo.ino !== pathInfo.ino ||
      openedInfo.size !== pathInfo.size ||
      (openedInfo.mode & 0o777) !== 0o600 ||
      (await realpath(resolvedPath)) !== resolvedPath
    ) {
      throw configurationError();
    }
    return await handle.readFile("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof Phase2rbDeepSeekConfigurationError) throw error;
    throw configurationError();
  } finally {
    await handle?.close();
  }
}

/** This function may only be called after the durable authorization marker exists. */
export async function loadPhase2rbDeepSeekConfig({
  env = process.env,
  repositoryRoot = PHASE2RB_REPOSITORY_ROOT,
  readEnvFileImpl = readPhase2rbEnvFile,
  parseEnvImpl = parsePhase2rbEnv,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const envPath = path.resolve(root, ".env");
  if (path.dirname(envPath) !== root) throw configurationError();

  let fileValues = Object.freeze(Object.create(null));
  try {
    const source = await readEnvFileImpl(envPath);
    if (source !== null) fileValues = parseEnvImpl(source);
  } catch (error) {
    if (error instanceof Phase2rbDeepSeekConfigurationError) throw error;
    throw configurationError();
  }
  if (!fileValues || typeof fileValues !== "object" || Array.isArray(fileValues)) {
    throw configurationError();
  }

  const configuredValue = (name) =>
    typeof env?.[name] === "string" ? env[name] : fileValues[name];
  const apiKey = configuredValue("DEEPSEEK_API_KEY");
  const model = configuredValue("DEEPSEEK_MODEL")?.trim() || PHASE2RB_MODEL;
  const baseUrl =
    configuredValue("DEEPSEEK_BASE_URL")?.trim() || PHASE2RB_BASE_URL;
  const timeoutText = configuredValue("DEEPSEEK_TIMEOUT_MS")?.trim();
  const timeoutMs = timeoutText ? Number(timeoutText) : PHASE2RB_TIMEOUT_MS;
  if (
    typeof apiKey !== "string" ||
    apiKey.length < 1 ||
    apiKey.length > 4_096 ||
    /\s/u.test(apiKey) ||
    model !== PHASE2RB_MODEL ||
    baseUrl !== PHASE2RB_BASE_URL ||
    timeoutMs !== PHASE2RB_TIMEOUT_MS
  ) {
    throw configurationError();
  }
  return Object.freeze({ apiKey, model, baseUrl, timeoutMs });
}
