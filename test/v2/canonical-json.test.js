import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
  isSha256Hash,
} from "../../src/v2/validation/canonical-json.js";

test("canonical JSON recursively sorts keys by Unicode code point", () => {
  const value = {
    "2": "numeric-looking key",
    "10": "lexically first",
    "😀": 4,
    "\uE000": 3,
    nested: { z: 1, a: 2 },
    array: [{ b: 1, a: 2 }, "kept"],
  };

  assert.equal(
    canonicalJsonStringify(value),
    '{"10":"lexically first","2":"numeric-looking key","array":[{"a":2,"b":1},"kept"],"nested":{"a":2,"z":1},"\uE000":3,"😀":4}',
  );
});

test("canonical hash is stable across insertion order and preserves array order", () => {
  const left = { z: 1, a: { y: true, x: null }, rows: [1, 2] };
  const right = { rows: [1, 2], a: { x: null, y: true }, z: 1 };
  const reorderedArray = { rows: [2, 1], a: { x: null, y: true }, z: 1 };

  assert.equal(hashCanonicalJson(left), hashCanonicalJson(right));
  assert.notEqual(hashCanonicalJson(left), hashCanonicalJson(reorderedArray));
  assert.match(hashCanonicalJson(left), /^sha256:[0-9a-f]{64}$/);
});

test("UTF-8 text hashing uses the documented prefixed lowercase SHA-256", () => {
  assert.equal(
    hashUtf8("abc"),
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(isSha256Hash(hashUtf8("通知")), true);
  assert.equal(isSha256Hash("BAAD"), false);
});

test("canonical JSON rejects values JSON would silently alter or omit", () => {
  assert.throws(() => canonicalJsonStringify(undefined), TypeError);
  assert.throws(() => canonicalJsonStringify(Number.NaN), TypeError);
  assert.throws(() => canonicalJsonStringify(Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => canonicalJsonStringify(new Date()), TypeError);
  assert.throws(() => canonicalJsonStringify([, 1]), TypeError);
  assert.throws(() => canonicalJsonStringify({ ignored: undefined }), TypeError);

  const withGetter = {};
  Object.defineProperty(withGetter, "value", {
    enumerable: true,
    get: () => 1,
  });
  assert.throws(() => canonicalJsonStringify(withGetter), TypeError);

  const withSymbol = { okay: true };
  withSymbol[Symbol("hidden")] = "not JSON";
  assert.throws(() => canonicalJsonStringify(withSymbol), TypeError);
});

test("canonical JSON rejects cycles but permits a shared non-cyclic object", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJsonStringify(cyclic), /circular/u);

  const shared = { safe: true };
  assert.equal(
    canonicalJsonStringify({ left: shared, right: shared }),
    '{"left":{"safe":true},"right":{"safe":true}}',
  );
});
