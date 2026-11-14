/**
 * Pages Functions adapter tests.
 *
 * Cloudflare turns every file under functions/ into a route. These tests check
 * that each adapter really exports an `onRequest` handler and that it forwards
 * `context.request` / `context.env` into the shared handler unchanged — i.e.
 * the routing glue cannot silently drop the KV binding or the secret.
 *
 *   node --test test/routes.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import * as health from "../functions/health.js";
import * as feedback from "../functions/api/feedback.js";
import * as weights from "../functions/api/weights.js";
import * as feedbackEvents from "../functions/api/feedback-events.js";
import { MockKV } from "./kv-mock.js";

const KEY = "pages-route-test-key";
const DOMAIN = "ai-embedded";
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = join(HERE, "..", "functions");

function makeEnv(kv, extra = {}) {
  return { WEIGHTS_KV: kv, FEEDBACK_KEY: KEY, ALLOWED_DOMAINS: DOMAIN, ...extra };
}

function request(path, method = "GET", body, key = KEY) {
  const headers = {};
  if (key !== null) headers["X-Feedback-Key"] = key;
  let text;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    text = JSON.stringify(body);
  }
  return new Request(`https://ai-daily-report-feedback.pages.dev${path}`, {
    method,
    headers,
    body: text,
  });
}

const validBody = () => ({
  domain: DOMAIN,
  delta: 1,
  date: "2026-11-14",
  eventId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
});

// ---------------------------------------------------------------- adapters

test("每个路由文件都导出 onRequest 函数", () => {
  for (const [name, mod] of [
    ["health.js", health],
    ["api/feedback.js", feedback],
    ["api/weights.js", weights],
  ]) {
    assert.equal(typeof mod.onRequest, "function", `${name} 应导出 onRequest`);
  }
});

test("health 适配器：转发 request/env，返回 /health 响应", async () => {
  const res = await health.onRequest({
    request: request("/health", "GET", undefined, null),
    env: makeEnv(new MockKV()),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, "string");
});

test("feedback 适配器：没有密钥时返回 401（证明 env 被透传）", async () => {
  const res = await feedback.onRequest({
    request: request("/api/feedback", "POST", validBody(), null),
    env: makeEnv(new MockKV()),
  });
  assert.equal(res.status, 401);
});

test("feedback 适配器：FEEDBACK_KEY 未配置时不会放行", async () => {
  const res = await feedback.onRequest({
    request: request("/api/feedback", "POST", validBody()),
    env: makeEnv(new MockKV(), { FEEDBACK_KEY: "" }),
  });
  assert.equal(res.status, 401);
});

test("feedback 适配器：正常写入并返回权重", async () => {
  const kv = new MockKV();
  const res = await feedback.onRequest({
    request: request("/api/feedback", "POST", validBody()),
    env: makeEnv(kv),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).weight, 1);
  assert.equal(JSON.parse(kv.peek(`weight:${DOMAIN}`)).weight, 1);
});

test("weights 适配器：透传 WEIGHTS_KV 绑定并可读回写入值", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);

  await feedback.onRequest({
    request: request("/api/feedback", "POST", validBody()),
    env,
  });
  const res = await weights.onRequest({
    request: request("/api/weights", "GET"),
    env,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.weights[DOMAIN].weight, 1);
});

test("weights 适配器：缺少密钥返回 401", async () => {
  const res = await weights.onRequest({
    request: request("/api/weights", "GET", undefined, null),
    env: makeEnv(new MockKV()),
  });
  assert.equal(res.status, 401);
});

test("适配器沿用同一套 CORS 与 404 逻辑", async () => {
  const headers = new Headers({
    "X-Feedback-Key": KEY,
    Origin: "https://yth-beep.github.io",
  });
  const ok = await weights.onRequest({
    request: new Request("https://ai-daily-report-feedback.pages.dev/api/weights", {
      headers,
    }),
    env: makeEnv(new MockKV()),
  });
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://yth-beep.github.io");

  const missing = await health.onRequest({
    request: request("/nope", "GET", undefined, null),
    env: makeEnv(new MockKV()),
  });
  assert.equal(missing.status, 404);
});

// ------------------------------------------------------------ route layout

test("functions/ 下的路由布局与公开 API 一致", async () => {
  const files = await listFunctionRoutes(FUNCTIONS_DIR);
  assert.deepEqual(files.sort(),
    ["api/feedback-events.js", "api/feedback.js", "api/weights.js", "health.js"]);
});

/** Recursively collect route files, skipping `_`-prefixed paths (Pages ignores them). */
async function listFunctionRoutes(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFunctionRoutes(full, base)));
    } else if (entry.name.endsWith(".js")) {
      out.push(relative(base, full).split("\\").join("/"));
    }
  }
  return out;
}
