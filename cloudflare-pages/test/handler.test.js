/**
 * API behaviour tests for the Pages Functions backend.
 *
 * Equivalent to backend/test/index.test.js (Worker, 19 checks) plus the extra
 * KV concurrency-boundary cases that only apply to the Pages implementation.
 *
 *   node --test test/handler.test.js
 *
 * No network, no Cloudflare account, no real KV.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_TTL_SECONDS,
  MAX_WRITE_ATTEMPTS,
  VERSION,
  handleRequest,
} from "../functions/_shared/handler.js";
import { MockKV } from "./kv-mock.js";

const KEY = "pages-unit-test-key";
const DOMAIN = "ai-embedded";
const DAY = "2026-11-14";

function makeEnv(kv, extra = {}) {
  return {
    WEIGHTS_KV: kv,
    FEEDBACK_KEY: KEY,
    ALLOWED_DOMAINS: DOMAIN,
    ...extra,
  };
}

let counter = 0;
function uuid() {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function payload(overrides = {}) {
  return { domain: DOMAIN, delta: 1, date: DAY, eventId: uuid(), ...overrides };
}

function call(env, method, path, body, options = {}) {
  const headers = {};
  if (options.key !== null) headers["X-Feedback-Key"] = options.key ?? KEY;
  if (options.origin) headers.Origin = options.origin;
  let text;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    text = typeof body === "string" ? body : JSON.stringify(body);
  }
  return handleRequest(
    new Request(`https://ai-daily-report-feedback.pages.dev${path}`, {
      method,
      headers,
      body: text,
    }),
    env,
  );
}

const read = (res) => res.json();

// ------------------------------------------------------------------ health

test("GET /health 无需密钥，返回 ok 与版本", async () => {
  const res = await call(makeEnv(new MockKV()), "GET", "/health", undefined, {
    key: null,
  });
  assert.equal(res.status, 200);
  const body = await read(res);
  assert.equal(body.ok, true);
  assert.equal(body.version, VERSION);
});

test("POST /health 返回 405", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/health");
  assert.equal(res.status, 405);
  assert.equal((await read(res)).error, "method not allowed");
});

// -------------------------------------------------------------------- auth

test("缺少 X-Feedback-Key 返回 401", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", payload(), {
    key: null,
  });
  assert.equal(res.status, 401);
  assert.equal((await res.text()).includes(KEY), false);
});

test("密钥错误返回 401", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", payload(), {
    key: "wrong-key",
  });
  assert.equal(res.status, 401);
});

test("FEEDBACK_KEY 未配置时一律 401（空密钥不放行）", async () => {
  const env = makeEnv(new MockKV(), { FEEDBACK_KEY: undefined });
  const res = await call(env, "POST", "/api/feedback", payload(), { key: "" });
  assert.equal(res.status, 401);
});

test("GET /api/weights 也需要密钥", async () => {
  const res = await call(makeEnv(new MockKV()), "GET", "/api/weights", undefined, {
    key: null,
  });
  assert.equal(res.status, 401);
});

// ------------------------------------------------------------ feedback write

test("+1 首次反馈写入权重 1 并返回 updatedAt", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const res = await call(env, "POST", "/api/feedback", payload());
  assert.equal(res.status, 200);
  const body = await read(res);
  assert.equal(body.ok, true);
  assert.equal(body.delta, 1);
  assert.equal(body.domain, DOMAIN);
  assert.equal(body.weight, 1);
  assert.match(body.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(kv.peek(`weight:${DOMAIN}`)).weight, 1);
});

test("-1 负向反馈生效", async () => {
  const env = makeEnv(new MockKV());
  const res = await call(env, "POST", "/api/feedback", payload({ delta: -1 }));
  assert.equal((await read(res)).weight, -1);
});

test("幂等：同一 eventId 重复提交只生效一次", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const body = payload();
  const first = await read(await call(env, "POST", "/api/feedback", body));
  const secondRes = await call(env, "POST", "/api/feedback", body);
  const second = await read(secondRes);

  assert.equal(first.weight, 1);
  assert.equal(secondRes.status, 200);
  assert.equal(second.idempotent, true);
  assert.equal(second.weight, 1);
  assert.equal(JSON.parse(kv.peek(`weight:${DOMAIN}`)).weight, 1);
  // Only the receipt and one weight write happened.
  assert.equal(kv.putLog.filter((p) => p.key.startsWith("weight:")).length, 1);
});

test("权重跨请求累计，GET /api/weights 读到最新值", async () => {
  const env = makeEnv(new MockKV());
  await call(env, "POST", "/api/feedback", payload());
  await call(env, "POST", "/api/feedback", payload());
  await call(env, "POST", "/api/feedback", payload({ delta: -1 }));

  const body = await read(await call(env, "GET", "/api/weights"));
  assert.equal(body.ok, true);
  assert.equal(body.weights[DOMAIN].weight, 1);
});

test("clamp：连续 +1 上限 +10", async () => {
  const env = makeEnv(new MockKV());
  for (let i = 0; i < 12; i++) {
    await call(env, "POST", "/api/feedback", payload());
  }
  const body = await read(await call(env, "GET", "/api/weights"));
  assert.equal(body.weights[DOMAIN].weight, 10);
});

test("clamp：连续 -1 下限 -10", async () => {
  const env = makeEnv(new MockKV());
  for (let i = 0; i < 12; i++) {
    await call(env, "POST", "/api/feedback", payload({ delta: -1 }));
  }
  const body = await read(await call(env, "GET", "/api/weights"));
  assert.equal(body.weights[DOMAIN].weight, -10);
});

test("事件回执写入 KV 且 TTL 为 30 天", async () => {
  const kv = new MockKV();
  const eventId = uuid();
  await call(makeEnv(kv), "POST", "/api/feedback", payload({ eventId }));

  const receiptPut = kv.putLog.find((p) => p.key === `event:${eventId}`);
  assert.ok(receiptPut, "应写入事件回执");
  assert.equal(receiptPut.expirationTtl, EVENT_TTL_SECONDS);
  const weightPut = kv.putLog.find((p) => p.key === `weight:${DOMAIN}`);
  assert.equal(weightPut.expirationTtl, undefined);
});

// ---------------------------------------------------------------- validation

test("非白名单领域返回 400", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", payload({ domain: "hack" }));
  assert.equal(res.status, 400);
  assert.equal((await read(res)).error, "invalid domain");
});

test("delta 只接受 +1 / -1", async () => {
  const env = makeEnv(new MockKV());
  for (const delta of [2, 0, -2, "1", 1.5, null]) {
    const res = await call(env, "POST", "/api/feedback", payload({ delta }));
    assert.equal(res.status, 400, `delta=${JSON.stringify(delta)}`);
    assert.equal((await read(res)).error, "invalid delta");
  }
});

test("日期格式非法返回 400", async () => {
  const env = makeEnv(new MockKV());
  for (const date of ["2026/11/14", "20261114", "2026-13-01", "", "2026-02-30"]) {
    const res = await call(env, "POST", "/api/feedback", payload({ date }));
    assert.equal(res.status, 400, `date=${date}`);
    assert.equal((await read(res)).error, "invalid date");
  }
});

test("年份超出合理范围返回 400", async () => {
  const env = makeEnv(new MockKV());
  for (const date of ["2019-01-01", "2099-01-01"]) {
    const res = await call(env, "POST", "/api/feedback", payload({ date }));
    assert.equal(res.status, 400, `date=${date}`);
  }
});

test("eventId 必须是 UUID", async () => {
  const env = makeEnv(new MockKV());
  for (const eventId of ["abc", "", 123, "00000000-0000-4000-8000-00000000000"]) {
    const res = await call(env, "POST", "/api/feedback", payload({ eventId }));
    assert.equal(res.status, 400, `eventId=${String(eventId)}`);
    assert.equal((await read(res)).error, "invalid eventId");
  }
});

test("非法 JSON 返回 400", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", "{not json");
  assert.equal(res.status, 400);
  assert.equal((await read(res)).error, "invalid JSON");
});

test("数组 JSON 返回 400", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", [1, 2, 3]);
  assert.equal(res.status, 400);
  assert.equal((await read(res)).error, "invalid JSON");
});

test("请求体超过 4KB 返回 413", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", {
    ...payload(),
    padding: "x".repeat(5000),
  });
  assert.equal(res.status, 413);
  assert.equal((await read(res)).error, "request body too large");
});

// ------------------------------------------------------------------- routing

test("GET /api/feedback 返回 405", async () => {
  const res = await call(makeEnv(new MockKV()), "GET", "/api/feedback", undefined, { key: KEY });
  assert.equal(res.status, 405);
});

test("POST /api/weights 返回 405", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/weights", {});
  assert.equal(res.status, 405);
});

test("未知路径返回 404", async () => {
  const res = await call(makeEnv(new MockKV()), "GET", "/nope", undefined, { key: KEY });
  assert.equal(res.status, 404);
  assert.equal((await read(res)).error, "not found");
});

// ---------------------------------------------------------------------- CORS

test("允许的来源回显 ACAO 与允许头", async () => {
  const res = await call(makeEnv(new MockKV()), "POST", "/api/feedback", payload(), {
    origin: "https://yth-beep.github.io",
  });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://yth-beep.github.io");
  assert.equal(res.headers.get("Vary"), "Origin");
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /X-Feedback-Key/);
});

test("未授权来源不返回 ACAO", async () => {
  const res = await call(makeEnv(new MockKV()), "GET", "/health", undefined, {
    key: null,
    origin: "https://evil.example",
  });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

test("OPTIONS 预检返回 204 且带允许方法", async () => {
  const res = await call(makeEnv(new MockKV()), "OPTIONS", "/api/feedback", undefined, {
    key: null,
    origin: "https://yth-beep.github.io",
  });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
});

// --------------------------------------------------- concurrency boundary

test("并发边界：权重写入被旧值覆盖时会重读重试并最终生效", async () => {
  const kv = new MockKV();
  kv.clobberPrefix = "weight:";
  kv.clobbersLeft = 1;
  const env = makeEnv(kv);

  const res = await call(env, "POST", "/api/feedback", payload());
  assert.equal(res.status, 200);
  assert.equal((await read(res)).weight, 1);
  // Two weight puts: the first one was clobbered, the second one stuck.
  assert.equal(kv.putLog.filter((p) => p.key.startsWith("weight:")).length, 2);
});

test("并发边界：持续被覆盖时返回 409 并删除事件回执（允许重试）", async () => {
  const kv = new MockKV();
  kv.clobberPrefix = "weight:";
  kv.clobbersLeft = 999;
  const eventId = uuid();
  const env = makeEnv(kv);

  const res = await call(env, "POST", "/api/feedback", payload({ eventId }));
  assert.equal(res.status, 409);
  assert.equal((await read(res)).error, "conflict, please retry");
  assert.equal(kv.putLog.filter((p) => p.key.startsWith("weight:")).length, MAX_WRITE_ATTEMPTS);
  assert.equal(kv.peek(`event:${eventId}`), null, "失败后应删除回执以便用同一 eventId 重试");
});

// ------------------------------------------------------------- failure mode

test("KV 异常返回 500，且不泄漏异常栈或密钥", async () => {
  const kv = new MockKV();
  kv.broken = true;
  const res = await call(makeEnv(kv), "POST", "/api/feedback", payload());
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(text.includes("boom"), false);
  assert.equal(text.includes("handler.js"), false);
  assert.equal(text.includes(KEY), false);
  assert.equal(JSON.parse(text).error, "internal error");
});

test("ALLOWED_DOMAINS 生效：只返回配置内的领域", async () => {
  const env = makeEnv(new MockKV(), { ALLOWED_DOMAINS: "ai-embedded, edge-ai" });
  const body = await read(await call(env, "GET", "/api/weights"));
  assert.deepEqual(Object.keys(body.weights).sort(), ["ai-embedded", "edge-ai"]);
  assert.equal(body.weights["edge-ai"].weight, 0);

  const res = await call(env, "POST", "/api/feedback", payload({ domain: "edge-ai" }));
  assert.equal(res.status, 200);
  assert.equal((await read(res)).weight, 1);
});
