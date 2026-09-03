import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { rawHttpRequest, request, startTestApp } from "./http-helpers.js";

test("core UI and local assets are available with security headers", async (t) => {
  const { baseUrl } = await startTestApp(t);
  const response = await request(baseUrl, "/");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src|'self'/i);
  assert.ok(response.headers.has("referrer-policy"));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);

  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /合成数据演示/);
  assert.match(html, /邀请码/);
  assert.match(html, /预览日历/);
  assert.match(html, /不会写入外部日历|未连接真实邮箱或日历/);
  assert.match(html, /aria-live=/i);
  assert.doesNotMatch(html, /<input[^>]+type=["']file["']/i);
  assert.doesNotMatch(html, /<textarea/i);
  assert.doesNotMatch(html, /DEEPSEEK_API_KEY|TEST-ONLY-SYNTHETIC-INVITE/);

  for (const [path, contentType] of [
    ["/app.js", "javascript"],
    ["/styles.css", "text/css"],
  ]) {
    const asset = await request(baseUrl, path);
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get("content-type") ?? "", new RegExp(contentType, "i"));
    assert.ok((await asset.text()).length > 100);
  }

  const app = await request(baseUrl, "/app.js");
  const appSource = await app.text();
  assert.match(appSource, /DeepSeek 回答/);
  assert.match(appSource, /预置回答/);
  assert.match(appSource, /安全策略回答/);
  assert.match(appSource, /生成安全预设/);
  assert.doesNotMatch(appSource, /追问 AI/);
});

test("browser JavaScript passes the Node syntax parser", () => {
  const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
  const result = spawnSync(process.execPath, ["--check", appPath], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("static server rejects traversal, dotfiles, source and unknown files", async (t) => {
  const { baseUrl } = await startTestApp(t);
  const paths = [
    "/../package.json",
    "/..%2fpackage.json",
    "/%2e%2e/package.json",
    "/%252e%252e%252fpackage.json",
    "/..\\package.json",
    "/%2fetc%2fpasswd",
    "/.env",
    "/package.json",
    "/src/config.js",
    "/test/fixtures.js",
    "/node_modules/example/index.js",
    "/missing-file.js",
  ];

  for (const path of paths) {
    const result = await rawHttpRequest(baseUrl, path);
    assert.notEqual(result.status, 200, path);
    assert.doesNotMatch(result.body, /ai-study-notification-center|DEEPSEEK_API_KEY|inviteCodes/);
  }
});

test("static resources only allow GET and HEAD", async (t) => {
  const { baseUrl } = await startTestApp(t);
  const head = await request(baseUrl, "/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const post = await request(baseUrl, "/app.js", {
    method: "POST",
    rawBody: "not allowed",
    headers: { "content-type": "text/plain" },
  });
  assert.equal(post.status, 405);
});
