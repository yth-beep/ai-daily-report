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

test("delta 只接受 +1 / -1，itemId 反馈额外接受 0=清除", async () => {
  const env = makeEnv(new MockKV());
  for (const delta of [2, -2, "1", 1.5, null]) {
    const res = await call(env, "POST", "/api/feedback", payload({ delta }));
    assert.equal(res.status, 400, `delta=${JSON.stringify(delta)}`);
    assert.equal((await read(res)).error, "invalid delta");
  }
  const noItem = await call(env, "POST", "/api/feedback", payload({ delta: 0 }));
  assert.equal(noItem.status, 400);
  const clear = await call(env, "POST", "/api/feedback", payload({
    delta: 0,
    itemId: "0123456789abcdef0123456789abcdef01234567",
  }));
  assert.equal(clear.status, 200);
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

// ------------------------------------------- per-item extras + event listing

test("POST 携带 itemId / tags / title 时接受并原样记录", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const eventId = uuid();
  const res = await call(env, "POST", "/api/feedback", {
    domain: DOMAIN,
    delta: 1,
    date: DAY,
    eventId,
    itemId: "0123456789abcdef0123456789abcdef01234567",
    tags: ["GPIO", "系统d", "I2C"],
    title: "嵌入式 Linux 上用 systemd 自启",
  });
  assert.equal(res.status, 200);
  const body = await read(res);
  assert.equal(body.itemLevel, true);
  const record = JSON.parse(kv.peek(`fevent:${eventId}`));
  assert.deepEqual(record.tags, ["GPIO", "系统d", "I2C"]);
  assert.equal(record.itemId, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(record.title, "嵌入式 Linux 上用 systemd 自启");
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("旧请求（只有 domain/delta/date/eventId）仍然通过", async () => {
  const env = makeEnv(new MockKV());
  const res = await call(env, "POST", "/api/feedback", {
    domain: DOMAIN, delta: -1, date: DAY, eventId: uuid(),
  });
  assert.equal(res.status, 200);
  assert.equal((await read(res)).weight, -1);
});

test("无 domain 的条目级反馈：记录事件但不写领域权重", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const eventId = uuid();
  const res = await call(env, "POST", "/api/feedback", {
    delta: -1, date: DAY, eventId, itemId: "abcdef123456", tags: ["OTA"],
  });
  assert.equal(res.status, 200);
  const body = await read(res);
  assert.equal(body.itemLevel, true);
  assert.equal(body.weight, null);
  assert.equal(kv.keys().some((k) => k.startsWith("weight:")), false);
  assert.equal(JSON.parse(kv.peek(`fevent:${eventId}`)).tags[0], "OTA");
});

test("非法 itemId 返回 400", async () => {
  const env = makeEnv(new MockKV());
  for (const itemId of ["x", "has space", "a".repeat(80), "<script>", 42]) {
    const res = await call(env, "POST", "/api/feedback", payload({ itemId }));
    assert.equal(res.status, 400, `itemId=${itemId}`);
    assert.equal((await read(res)).error, "invalid itemId");
  }
});

test("非法 tags 返回 400（非数组 / 超长 / 注入 / 超过 8 个）", async () => {
  const env = makeEnv(new MockKV());
  const bad = [
    "<script>",
    "a".repeat(33),
    "<b>bold</b>",
  ];
  for (const tag of bad) {
    const res = await call(env, "POST", "/api/feedback", payload({ tags: [tag] }));
    assert.equal(res.status, 400, `tag=${tag}`);
    assert.equal((await read(res)).error, "invalid tags");
  }
  const notArray = await call(env, "POST", "/api/feedback", payload({ tags: "GPIO" }));
  assert.equal(notArray.status, 400);
  const tooMany = await call(env, "POST", "/api/feedback",
    payload({ tags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }));
  assert.equal(tooMany.status, 400);
});

test("title 含尖括号或过长返回 400", async () => {
  const env = makeEnv(new MockKV());
  const bad = ["<script>alert(1)</script>", "a".repeat(121), 123];
  for (const title of bad) {
    const res = await call(env, "POST", "/api/feedback", payload({ title }));
    assert.equal(res.status, 400, `title=${String(title).slice(0, 12)}`);
    assert.equal((await read(res)).error, "invalid title");
  }
});

test("GET /api/feedback-events 需要密钥", async () => {
  const env = makeEnv(new MockKV());
  const res = await call(env, "GET", "/api/feedback-events", undefined, { key: null });
  assert.equal(res.status, 401);
});

test("GET /api/feedback-events 返回结构化事件（按时间排序）", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const e1 = uuid();
  const e2 = uuid();
  await call(env, "POST", "/api/feedback", {
    domain: DOMAIN, delta: 1, date: DAY, eventId: e1, tags: ["GPIO"], title: "A",
  });
  await call(env, "POST", "/api/feedback", {
    delta: -1, date: DAY, eventId: e2, tags: ["OTA", "systemd"], title: "B",
  });

  const res = await call(env, "GET", "/api/feedback-events");
  assert.equal(res.status, 200);
  const body = await read(res);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  const ids = body.events.map((e) => e.eventId);
  assert.deepEqual(ids.sort(), [e1, e2].sort());
  const itemLevel = body.events.find((e) => e.eventId === e2);
  assert.deepEqual(itemLevel.tags, ["OTA", "systemd"]);
  assert.equal(itemLevel.delta, -1);
  assert.equal(itemLevel.domain, "");
});

test("同一内容只按最后一次点击计入权重", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const itemId = "0123456789abcdef0123456789abcdef01234567";
  for (const delta of [1, 1, -1]) {
    const res = await call(env, "POST", "/api/feedback", {
      domain: DOMAIN, delta, date: DAY, eventId: uuid(), itemId,
      tags: ["GPIO", "systemd"], title: "同一内容",
    });
    assert.equal(res.status, 200);
  }

  const events = await read(await call(env, "GET", "/api/feedback-events"));
  assert.equal(events.count, 3);
  assert.equal(events.itemStates[itemId].delta, -1);

  const weights = await read(await call(env, "GET", "/api/weights"));
  assert.equal(weights.weights[DOMAIN].weight, -1);
});

test("清除标记写入 delta=0，并撤销该内容当前权重", async () => {
  const kv = new MockKV();
  const env = makeEnv(kv);
  const itemId = "abcdef0123456789abcdef0123456789abcdef01";
  await call(env, "POST", "/api/feedback", {
    domain: DOMAIN, delta: 1, date: DAY, eventId: uuid(), itemId,
    tags: ["GPIO"], title: "先加重",
  });
  const clear = await call(env, "POST", "/api/feedback", {
    domain: DOMAIN, delta: 0, date: DAY, eventId: uuid(), itemId,
    tags: ["GPIO"], title: "再清除",
  });
  const clearBody = await read(clear);
  assert.equal(clearBody.itemState.delta, 0);
  assert.equal(clearBody.itemState.itemId, itemId);

  const events = await read(await call(env, "GET", "/api/feedback-events"));
  assert.equal(events.count, 2);
  assert.equal(events.itemStates[itemId].delta, 0);
  const weights = await read(await call(env, "GET", "/api/weights"));
  assert.equal(weights.weights[DOMAIN].weight, 0);
});

test("POST /api/feedback-events 返回 405", async () => {
  const env = makeEnv(new MockKV());
  const res = await call(env, "POST", "/api/feedback-events", payload());
  assert.equal(res.status, 405);
});
