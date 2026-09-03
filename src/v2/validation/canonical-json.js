import { createHash } from "node:crypto";

const JSON_VALUE_ERROR = "value must contain only JSON-compatible data";

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const commonLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < commonLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }

  return leftPoints.length - rightPoints.length;
}

function serializeJsonValue(value, ancestors) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(JSON_VALUE_ERROR);
    }
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new TypeError(JSON_VALUE_ERROR);
  }

  if (ancestors.has(value)) {
    throw new TypeError("value must not contain circular references");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const serializedItems = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError(JSON_VALUE_ERROR);
        }
        serializedItems.push(serializeJsonValue(value[index], ancestors));
      }
      return `[${serializedItems.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(JSON_VALUE_ERROR);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(JSON_VALUE_ERROR);
    }

    const keys = Object.keys(value).sort(compareUnicodeCodePoints);
    const serializedEntries = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError(JSON_VALUE_ERROR);
      }
      return `${JSON.stringify(key)}:${serializeJsonValue(descriptor.value, ancestors)}`;
    });
    return `{${serializedEntries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Serialize a JSON value with object keys recursively ordered by Unicode code
 * point. Array order and string/number values are preserved.
 */
export function canonicalJsonStringify(value) {
  return serializeJsonValue(value, new WeakSet());
}

/** Hash exact UTF-8 text as a lowercase, prefixed SHA-256 digest. */
export function hashUtf8(text) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** Hash a JSON value after canonical serialization. */
export function hashCanonicalJson(value) {
  return hashUtf8(canonicalJsonStringify(value));
}

export function isSha256Hash(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

// Explicit aliases make the intent clear at call sites without maintaining a
// second implementation.
export const canonicalizeJson = canonicalJsonStringify;
export const sha256CanonicalJson = hashCanonicalJson;
