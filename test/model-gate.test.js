import test from "node:test";
import assert from "node:assert/strict";

import { createModelGate, ModelCapacityError } from "../src/agent/model-gate.js";

test("model gate limits concurrent requests and drains its bounded queue", async () => {
  let active = 0;
  let maximumActive = 0;
  const releases = [];
  const client = {
    configured: true,
    model: "deepseek-v4-flash",
    async createStructured({ id }) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return { id };
    },
  };
  const gate = createModelGate(client, { maxConcurrent: 2, maxQueued: 2 });

  const first = gate.createStructured({ id: 1 });
  const second = gate.createStructured({ id: 2 });
  const third = gate.createStructured({ id: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  while (releases.length > 0) releases.shift()();

  assert.deepEqual(await Promise.all([first, second, third]), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(maximumActive, 2);
});

test("model gate rejects work beyond its queue capacity", async () => {
  let release;
  const client = {
    configured: true,
    async createStructured() {
      await new Promise((resolve) => {
        release = resolve;
      });
      return {};
    },
  };
  const gate = createModelGate(client, { maxConcurrent: 1, maxQueued: 1 });
  const running = gate.createStructured({});
  const queued = gate.createStructured({});
  await assert.rejects(gate.createStructured({}), ModelCapacityError);

  await new Promise((resolve) => setImmediate(resolve));
  release();
  await running;
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await queued;
});
