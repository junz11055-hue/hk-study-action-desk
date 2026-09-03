const REDACTED_KEYS = new Set([
  "apikey",
  "authorization",
  "body",
  "code",
  "content",
  "cookie",
  "emailbody",
  "invitecode",
  "key",
  "question",
  "token",
]);

function sanitize(value, depth = 0) {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" && value.length > 240 ? `${value.slice(0, 240)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : sanitize(nested, depth + 1),
      ]),
    );
  }
  return String(value);
}

export function createLogger(sink = console) {
  function write(level, event, metadata = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...sanitize(metadata),
    };
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    sink[method](JSON.stringify(record));
  }

  return Object.freeze({
    info: (event, metadata) => write("info", event, metadata),
    warn: (event, metadata) => write("warn", event, metadata),
    error: (event, metadata) => write("error", event, metadata),
  });
}
