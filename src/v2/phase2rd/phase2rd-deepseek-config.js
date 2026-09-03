import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PHASE2RD_BASE_URL,
  PHASE2RD_MODEL,
  PHASE2RD_TIMEOUT_MS,
} from "./phase2rd-run-contract.js";

export const PHASE2RD_REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);
export const PHASE2RD_MAX_ENV_FILE_BYTES = 65_536;

export class Phase2rdDeepSeekConfigurationError extends Error {
  constructor() {
    super("Phase 2R-D DeepSeek configuration is unavailable or not frozen.");
    this.name = "Phase2rdDeepSeekConfigurationError";
    this.code = "model_configuration_invalid";
  }
}
function configurationError() {
  return new Phase2rdDeepSeekConfigurationError();
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

export function parsePhase2rdEnv(source) {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source, "utf8") > PHASE2RD_MAX_ENV_FILE_BYTES ||
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

export async function readPhase2rdEnvFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  let handle;
  try {
    const pathInfo = await lstat(resolvedPath);
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      (pathInfo.mode & 0o777) !== 0o600 ||
      pathInfo.size < 0 ||
      pathInfo.size > PHASE2RD_MAX_ENV_FILE_BYTES
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
    if (error instanceof Phase2rdDeepSeekConfigurationError) throw error;
    throw configurationError();
  } finally {
    await handle?.close();
  }
}

/** This function may only be called after the durable authorization marker exists. */
export async function loadPhase2rdDeepSeekConfig({
  env = process.env,
  repositoryRoot = PHASE2RD_REPOSITORY_ROOT,
  readEnvFileImpl = readPhase2rdEnvFile,
  parseEnvImpl = parsePhase2rdEnv,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const envPath = path.resolve(root, ".env");
  if (path.dirname(envPath) !== root) throw configurationError();

  let fileValues = Object.freeze(Object.create(null));
  try {
    const source = await readEnvFileImpl(envPath);
    if (source !== null) fileValues = parseEnvImpl(source);
  } catch (error) {
    if (error instanceof Phase2rdDeepSeekConfigurationError) throw error;
    throw configurationError();
  }
  if (!fileValues || typeof fileValues !== "object" || Array.isArray(fileValues)) {
    throw configurationError();
  }

  const configuredValue = (name) =>
    typeof env?.[name] === "string" ? env[name] : fileValues[name];
  const apiKey = configuredValue("DEEPSEEK_API_KEY");
  const model = configuredValue("DEEPSEEK_MODEL")?.trim() || PHASE2RD_MODEL;
  const baseUrl =
    configuredValue("DEEPSEEK_BASE_URL")?.trim() || PHASE2RD_BASE_URL;
  const timeoutText = configuredValue("DEEPSEEK_TIMEOUT_MS")?.trim();
  const timeoutMs = timeoutText ? Number(timeoutText) : PHASE2RD_TIMEOUT_MS;
  if (
    typeof apiKey !== "string" ||
    apiKey.length < 1 ||
    apiKey.length > 4_096 ||
    /\s/u.test(apiKey) ||
    model !== PHASE2RD_MODEL ||
    baseUrl !== PHASE2RD_BASE_URL ||
    timeoutMs !== PHASE2RD_TIMEOUT_MS
  ) {
    throw configurationError();
  }
  return Object.freeze({ apiKey, model, baseUrl, timeoutMs });
}
