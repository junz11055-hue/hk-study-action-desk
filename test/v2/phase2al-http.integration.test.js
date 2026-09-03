import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEV001_CAPTURED_REPLAY_CANDIDATE } from "../../src/v2/product/fixtures/offline-candidates.js";
import { createPhase2alProductRuntime } from "../../src/v2/phase2al/phase2al-product-runtime.js";

const TOKEN = "phase2al-offline-http-internal-token";
const SESSION = `sha256:${"9".repeat(64)}`;
const COLLECTION = "/api/v2/synthetic/analysis-tasks";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function headers(post = true) {
  return {
    Accept: "application/json",
    "X-Product-Api-Token": TOKEN,
    "X-Session-Scope-Digest": SESSION,
    ...(post
      ? {
          "Content-Type": "application/json",
          "Idempotency-Key": "88888888-8888-4888-8888-888888888888",
        }
      : {}),
  };
}

test("Live Product runtime traverses one fake HTTP task and closes its random loopback server", async (t) => {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "phase2al-http-")),
  );
  t.after(async () => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const runtime = await createPhase2alProductRuntime({
    taskDirectory: directory,
    internalToken: TOKEN,
    analyzer: {
      executionMode: "live_model",
      async analyze() {
        calls += 1;
        return {
          executionMode: "live_model",
          candidate: structuredClone(DEV001_CAPTURED_REPLAY_CANDIDATE),
        };
      },
    },
    serviceOptions: {
      clock: () => new Date("2026-09-01T04:00:00.000Z"),
    },
  });
  const baseUrl = await listen(runtime.server);
  try {
    const post = await fetch(`${baseUrl}${COLLECTION}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        contractVersion: "synthetic-analysis-request/v1",
        caseId: "DEV001",
      }),
      redirect: "error",
    });
    assert.equal(post.status, 202);
    const submitted = await post.json();
    assert.equal(submitted.executionMode, "live_model");
    await runtime.taskService.drain();

    const get = await fetch(`${baseUrl}${COLLECTION}/${submitted.taskId}`, {
      headers: headers(false),
      redirect: "error",
    });
    const task = await get.json();
    assert.equal(task.status, "succeeded");
    assert.equal(task.resource.card.provenance.sourceMode, "live_model");
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(task), /candidate_hash|api[_-]?key|prompt/iu);
  } finally {
    await close(runtime.server);
  }
  assert.equal(runtime.server.listening, false);
});
