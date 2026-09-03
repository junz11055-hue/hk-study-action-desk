import { randomBytes } from "node:crypto";

const DEFAULT_PORT = 4173;

function integerFromEnv(value, fallback, { min, max }) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function booleanFromEnv(value, fallback) {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function listFromEnv(value, fallback) {
  const items = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

const DEEPSEEK_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

function officialDeepSeekBaseUrl(value) {
  const raw = value?.trim() || "https://api.deepseek.com";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DEEPSEEK_BASE_URL must be the official DeepSeek HTTPS API root");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "api.deepseek.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("DEEPSEEK_BASE_URL must be https://api.deepseek.com");
  }
  return "https://api.deepseek.com";
}

function officialDeepSeekModel(value) {
  const model = value?.trim() || "deepseek-v4-flash";
  if (!DEEPSEEK_MODELS.has(model)) {
    throw new Error("DEEPSEEK_MODEL must be deepseek-v4-flash or deepseek-v4-pro");
  }
  return model;
}

export function loadConfig(env = process.env) {
  const runtimeMode = env.RUNTIME_MODE?.trim() || "synthetic";
  if (runtimeMode !== "synthetic") {
    throw new Error("Step 5 can only run in synthetic mode");
  }
  const port = integerFromEnv(env.PORT, DEFAULT_PORT, { min: 1, max: 65535 });
  const publicOrigin = env.PUBLIC_ORIGIN?.trim() || `http://127.0.0.1:${port || DEFAULT_PORT}`;
  const sessionTtlMinutes = integerFromEnv(env.SESSION_TTL_MINUTES, 240, {
    min: 15,
    max: 1_440,
  });
  const configuredInviteCodes = listFromEnv(env.DEMO_INVITE_CODES, []);
  const generatedInviteCode =
    configuredInviteCodes.length === 0 ? `HK-${randomBytes(18).toString("base64url")}` : null;

  return Object.freeze({
    runtimeMode,
    host: "127.0.0.1",
    port,
    publicOrigin,
    inviteCodes: configuredInviteCodes.length > 0 ? configuredInviteCodes : [generatedInviteCode],
    generatedInviteCode,
    inviteMaxUses: integerFromEnv(env.DEMO_INVITE_MAX_USES, 25, { min: 1, max: 500 }),
    sessionTtlMs: sessionTtlMinutes * 60_000,
    deepseek: Object.freeze({
      apiKey: env.DEEPSEEK_API_KEY?.trim() || "",
      model: officialDeepSeekModel(env.DEEPSEEK_MODEL),
      baseUrl: officialDeepSeekBaseUrl(env.DEEPSEEK_BASE_URL),
      timeoutMs: integerFromEnv(env.MODEL_TIMEOUT_MS, 90_000, { min: 3_000, max: 120_000 }),
      maxRetries: integerFromEnv(env.MODEL_MAX_RETRIES, 2, { min: 1, max: 4 }),
    }),
    modelProcessBudget: integerFromEnv(env.MODEL_PROCESS_BUDGET, 100, { min: 1, max: 1_000 }),
    allowPresetFallback: booleanFromEnv(env.ALLOW_PRESET_FALLBACK, true),
  });
}

export const config = loadConfig();
