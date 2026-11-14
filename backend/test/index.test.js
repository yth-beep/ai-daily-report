/**
 * Backend tests using an in-memory KV mock. No real Cloudflare, no network.
 * Run with:  node --test test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/index.js";

const KEY = "test-secret-key";
const DOMAINS = "ai-embedded";
const ORIGIN = "https://yth-beep.github.io";

class MemoryKV {
  constructor() {
    this.store = new Map();
    this.ttl = new Map();
  }
  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async put(key, value, opts) {
    this.store.set(key, value);
    if (opts && opts.expirationTtl) this.ttl.set(key, opts.expirationTtl);
  }
}

function makeEnv() {
  return {
    FEEDBACK_KEY: KEY,
    ALLOWED_DOMAINS: DOMAINS,
    WEIGHTS_KV: new MemoryKV(),
  };
}

function req(method, path, { body, key, origin } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (key !== undefined) headers.set("X-Feedback-Key", key);
  if (origin) headers.set("Origin", origin);
  return new Request(`https://example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(...args) {
  return await handleRequest(...args);
}

function uuid(seed = 0) {
  // Deterministic, always-valid UUID v4-shaped string, distinct per seed.
  const hex = (seed >>> 0).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

// ------------------------------------------------------------------ health
test("GET /health 无需密钥，返回 ok 和版本", async () => {
  const res = await call(req("GET", "/health"), makeEnv());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(typeof data.version, "string");
});

// ------------------------------------------------------------------ auth
test("POST /api/feedback 密钥错误返回 401", async () => {
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: uuid() }, key: "wrong" }),
    makeEnv(),
  );
  assert.equal(res.status, 401);
});

test("GET /api/weights 密钥错误返回 401", async () => {
  const res = await call(req("GET", "/api/weights", { key: "wrong" }), makeEnv());
  assert.equal(res.status, 401);
});

// ------------------------------------------------------------------ CORS
test("CORS：允许来源返回 Access-Control-Allow-Origin", async () => {
  const res = await call(
    req("GET", "/health", { origin: ORIGIN }),
    makeEnv(),
  );
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("CORS：非白名单来源不返回允许头", async () => {
  const res = await call(
    req("GET", "/health", { origin: "https://evil.example.com" }),
    makeEnv(),
  );
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

test("OPTIONS 预检返回 204", async () => {
  const res = await call(
    req("OPTIONS", "/api/feedback", { origin: ORIGIN }),
    makeEnv(),
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

// ------------------------------------------------------------------ validation
test("非法 domain 返回 400", async () => {
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "hack", delta: 1, date: "2026-11-14", eventId: uuid() }, key: KEY }),
    makeEnv(),
  );
  assert.equal(res.status, 400);
});

test("非法 delta 返回 400", async () => {
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 5, date: "2026-11-14", eventId: uuid() }, key: KEY }),
    makeEnv(),
  );
  assert.equal(res.status, 400);
});

test("非法 date 返回 400", async () => {
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026/11/14", eventId: uuid() }, key: KEY }),
    makeEnv(),
  );
  assert.equal(res.status, 400);
});

test("非法 eventId 返回 400", async () => {
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: "not-a-uuid" }, key: KEY }),
    makeEnv(),
  );
  assert.equal(res.status, 400);
});

// ------------------------------------------------------------------ +1 / -1
test("+1 反馈：权重从 0 变 1", async () => {
  const env = makeEnv();
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: uuid() }, key: KEY }),
    env,
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.weight, 1);
});

test("-1 反馈：权重从 0 变 -1", async () => {
  const env = makeEnv();
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: -1, date: "2026-11-14", eventId: uuid() }, key: KEY }),
    env,
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.weight, -1);
});

// ------------------------------------------------------------------ idempotency
test("幂等：同一 eventId 只生效一次", async () => {
  const env = makeEnv();
  const id = uuid();
  const first = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: id }, key: KEY }),
    env,
  );
  assert.equal((await first.json()).weight, 1);
  const second = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: id }, key: KEY }),
    env,
  );
  const data2 = await second.json();
  assert.equal(data2.weight, 1); // still 1, not 2
  assert.equal(data2.idempotent, true);
});

// ------------------------------------------------------------------ clamp
test("权重 clamp：不会超过 +10", async () => {
  const env = makeEnv();
  // 10 x +1 -> weight 10
  for (let i = 0; i < 10; i++) {
    await call(
      req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: uuid(i) }, key: KEY }),
      env,
    );
  }
  // 11th +1 -> clamp to 10
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: uuid(100) }, key: KEY }),
    env,
  );
  assert.equal((await res.json()).weight, 10);
});

test("权重 clamp：不会低于 -10", async () => {
  const env = makeEnv();
  // 11 x -1 -> clamp to -10
  for (let i = 0; i < 11; i++) {
    await call(
      req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: -1, date: "2026-11-14", eventId: uuid(i) }, key: KEY }),
      env,
    );
  }
  const w = await call(req("GET", "/api/weights", { key: KEY }), env);
  const data = await w.json();
  assert.equal(data.weights["ai-embedded"].weight, -10);
});

// ------------------------------------------------------------------ weights
test("GET /api/weights 返回各领域权重与 updatedAt", async () => {
  const env = makeEnv();
  await call(
    req("POST", "/api/feedback", { body: { domain: "ai-embedded", delta: 1, date: "2026-11-14", eventId: uuid() }, key: KEY }),
    env,
  );
  const res = await call(req("GET", "/api/weights", { key: KEY }), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.weights["ai-embedded"].weight, 1);
  assert.equal(typeof data.weights["ai-embedded"].updatedAt, "string");
});

// ------------------------------------------------------------------ method/route
test("未知路由返回 404", async () => {
  const res = await call(req("GET", "/nope"), makeEnv());
  assert.equal(res.status, 404);
});

test("方法错误返回 405", async () => {
  const res = await call(req("GET", "/api/feedback", { key: KEY }), makeEnv());
  assert.equal(res.status, 405);
});

test("响应体不泄漏密钥或异常栈", async () => {
  const res = await call(
    req("POST", "/api/feedback", { body: { domain: "bad", delta: 1, date: "2026-11-14", eventId: uuid() }, key: KEY }),
    makeEnv(),
  );
  const text = await res.text();
  assert.equal(text.includes(KEY), false);
  assert.equal(text.includes("stack"), false);
});
