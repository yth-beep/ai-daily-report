/**
 * Tests for the Deno Deploy feedback backend.
 *
 * Runs entirely against an in-memory KV mock: no network, no Deno Deploy, no
 * real KV store. Zero third-party dependencies.
 *
 *   deno test test.ts
 */

import { createHandler, MAX_COMMIT_ATTEMPTS } from "./main.ts";
import type {
  AtomicCheckLike,
  AtomicLike,
  HandlerOptions,
  KvLike,
} from "./main.ts";

// ---------------------------------------------------------------- assertions

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

function assertIncludes(haystack: string, needle: string, message = ""): void {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${message} expected to include ${needle}, got ${haystack}`,
    );
  }
}

function assertExcludes(haystack: string, needle: string, message = ""): void {
  if (haystack.includes(needle)) {
    throw new Error(`${message} must not include ${needle}, got ${haystack}`);
  }
}

// --------------------------------------------------------------- KV mock

interface StoredEntry {
  value: unknown;
  versionstamp: string;
  expireIn?: number;
  setOptionsSeen: boolean;
}

class MockAtomic implements AtomicLike {
  #checks: AtomicCheckLike[] = [];
  #sets: { key: Deno.KvKey; value: unknown; expireIn?: number }[] = [];

  constructor(private readonly kv: MockKv) {}

  check(...checks: AtomicCheckLike[]): AtomicLike {
    this.#checks.push(...checks);
    return this;
  }

  set(
    key: Deno.KvKey,
    value: unknown,
    options?: { expireIn?: number },
  ): AtomicLike {
    this.#sets.push({ key, value, expireIn: options?.expireIn });
    return this;
  }

  commit(): Promise<{ ok: boolean }> {
    this.kv.commits += 1;
    if (this.kv.failCommits) return Promise.resolve({ ok: false });

    const checksPass = this.#checks.every((check) => {
      const current = this.kv.peek(check.key);
      if (check.versionstamp === null) return current === undefined;
      return current !== undefined &&
        current.versionstamp === check.versionstamp;
    });
    if (!checksPass) return Promise.resolve({ ok: false });

    for (const item of this.#sets) {
      this.kv.write(item.key, item.value, item.expireIn);
    }
    return Promise.resolve({ ok: true });
  }
}

class MockKv implements KvLike {
  #data = new Map<string, StoredEntry>();
  #seq = 0;

  commits = 0;
  failCommits = false;
  lastExpireIn: number | undefined;

  static keyOf(key: Deno.KvKey): string {
    return JSON.stringify(key);
  }

  get<T = unknown>(key: Deno.KvKey): Promise<Deno.KvEntryMaybe<T>> {
    const hit = this.#data.get(MockKv.keyOf(key));
    if (hit === undefined) {
      return Promise.resolve({ key, value: null, versionstamp: null });
    }
    return Promise.resolve({
      key,
      value: hit.value as T,
      versionstamp: hit.versionstamp,
    });
  }

  peek(key: Deno.KvKey): StoredEntry | undefined {
    return this.#data.get(MockKv.keyOf(key));
  }

  write(key: Deno.KvKey, value: unknown, expireIn?: number): void {
    this.#data.set(MockKv.keyOf(key), {
      value,
      versionstamp: String(++this.#seq).padStart(20, "0"),
      expireIn,
      setOptionsSeen: true,
    });
    if (expireIn !== undefined) this.lastExpireIn = expireIn;
  }

  countEventKeys(): number {
    let n = 0;
    for (const k of this.#data.keys()) {
      if (k.startsWith('["event"')) n += 1;
    }
    return n;
  }

  atomic(): AtomicLike {
    return new MockAtomic(this);
  }
}

// ------------------------------------------------------------------ helpers

const KEY = "unit-test-feedback-key";
const DOMAIN = "ai-embedded";
const DAY = "2026-11-14";
const NOW_MS = Date.UTC(2026, 10, 14, 2, 30, 0); // 2026-11-14T02:30:00Z

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

interface Harness {
  handler: (request: Request) => Promise<Response>;
  kv: MockKv;
}

function makeHarness(overrides: Partial<HandlerOptions> = {}): Harness {
  const kv = new MockKv();
  const env: Record<string, string> = { FEEDBACK_KEY: KEY };
  const handler = createHandler({
    kv,
    env: (name: string) => env[name],
    now: () => NOW_MS,
    ...overrides,
  });
  return { handler, kv };
}

function makeHarnessWithEnv(
  env: Record<string, string>,
  kv: MockKv = new MockKv(),
): Harness {
  const handler = createHandler({
    kv,
    env: (name: string) => env[name],
    now: () => NOW_MS,
  });
  return { handler, kv };
}

interface CallOptions {
  key?: string | null;
  headers?: Record<string, string>;
  url?: string;
}

function call(
  handler: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
  options: CallOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.key !== null) headers["X-Feedback-Key"] = options.key ?? KEY;
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  return handler(
    new Request(`https://feedback.example.test${path}`, {
      method,
      headers,
      body: payload,
    }),
  );
}

function payload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    domain: DOMAIN,
    delta: 1,
    date: DAY,
    eventId: uuid(1),
    ...overrides,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

// ------------------------------------------------------------------- health

Deno.test("/health: 无需密钥，返回 ok 与版本", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "GET", "/health", undefined, { key: null });
  assertEquals(res.status, 200, "status");
  const body = await readJson(res);
  assertEquals(body.ok, true, "ok");
  assertEquals(body.version, "1.0.0", "version");
});

Deno.test("/health: 非 GET 返回 405", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/health");
  assertEquals(res.status, 405, "status");
  assertEquals((await readJson(res)).error, "method not allowed", "error");
});

// --------------------------------------------------------------------- auth

Deno.test("鉴权：缺少 X-Feedback-Key 返回 401", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/feedback", payload(), {
    key: null,
  });
  assertEquals(res.status, 401, "status");
  const text = await res.text();
  assertExcludes(text, KEY, "401 响应不得泄漏密钥");
});

Deno.test("鉴权：密钥错误返回 401", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/feedback", payload(), {
    key: "wrong-key",
  });
  assertEquals(res.status, 401, "status");
});

Deno.test("鉴权：FEEDBACK_KEY 未配置时任何请求都 401（不允许空密钥放行）", async () => {
  const { handler } = makeHarnessWithEnv({});
  const res = await call(handler, "POST", "/api/feedback", payload(), {
    key: "",
  });
  assertEquals(res.status, 401, "status");
});

Deno.test("鉴权：GET /api/weights 也需要密钥", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "GET", "/api/weights", undefined, {
    key: null,
  });
  assertEquals(res.status, 401, "status");
});

// ------------------------------------------------------------ feedback write

Deno.test("+1：首次反馈写入权重 1 并返回 updatedAt", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/feedback", payload());
  assertEquals(res.status, 200, "status");
  const body = await readJson(res);
  assertEquals(body.ok, true, "ok");
  assertEquals(body.weight, 1, "weight");
  assertEquals(body.delta, 1, "delta");
  assertEquals(body.domain, DOMAIN, "domain");
  assertEquals(
    body.updatedAt,
    new Date(NOW_MS).toISOString(),
    "updatedAt 使用注入时钟",
  );
});

Deno.test("-1：负向反馈生效", async () => {
  const { handler } = makeHarness();
  const res = await call(
    handler,
    "POST",
    "/api/feedback",
    payload({ delta: -1, eventId: uuid(2) }),
  );
  assertEquals((await readJson(res)).weight, -1, "weight");
});

Deno.test("幂等：同一 eventId 重复提交只生效一次", async () => {
  const { handler } = makeHarness();
  const body = payload({ eventId: uuid(3) });
  const first = await readJson(
    await call(handler, "POST", "/api/feedback", body),
  );
  const second = await call(handler, "POST", "/api/feedback", body);
  const secondBody = await readJson(second);

  assertEquals(first.weight, 1, "第一次 weight");
  assertEquals(second.status, 200, "第二次 status");
  assertEquals(secondBody.idempotent, true, "第二次应标记 idempotent");
  assertEquals(secondBody.weight, 1, "第二次 weight 不变");
});

Deno.test("并发：两个不同 eventId 同时提交都能累加（无丢失更新）", async () => {
  const { handler } = makeHarness();
  const results = await Promise.all([
    call(handler, "POST", "/api/feedback", payload({ eventId: uuid(10) })),
    call(handler, "POST", "/api/feedback", payload({ eventId: uuid(11) })),
  ]);
  assertEquals(results[0].status, 200, "第一个 status");
  assertEquals(results[1].status, 200, "第二个 status");

  const weights = await readJson(await call(handler, "GET", "/api/weights"));
  const entry = (weights.weights as Record<string, { weight: number }>)[DOMAIN];
  assertEquals(entry.weight, 2, "权重应为 2，不能丢一次更新");
});

Deno.test("并发：同一 eventId 同时提交只生效一次", async () => {
  const { handler } = makeHarness();
  const body = payload({ eventId: uuid(12) });
  const results = await Promise.all([
    call(handler, "POST", "/api/feedback", body),
    call(handler, "POST", "/api/feedback", body),
  ]);
  assertEquals(results[0].status, 200, "第一个 status");
  assertEquals(results[1].status, 200, "第二个 status");

  const weights = await readJson(await call(handler, "GET", "/api/weights"));
  const entry = (weights.weights as Record<string, { weight: number }>)[DOMAIN];
  assertEquals(entry.weight, 1, "同一 eventId 只能生效一次");
});

Deno.test("clamp：连续 +1 上限 +10", async () => {
  const { handler } = makeHarness();
  for (let i = 0; i < 12; i++) {
    await call(
      handler,
      "POST",
      "/api/feedback",
      payload({ eventId: uuid(100 + i) }),
    );
  }
  const weights = await readJson(await call(handler, "GET", "/api/weights"));
  const entry = (weights.weights as Record<string, { weight: number }>)[DOMAIN];
  assertEquals(entry.weight, 10, "权重上限 +10");
});

Deno.test("clamp：连续 -1 下限 -10", async () => {
  const { handler } = makeHarness();
  for (let i = 0; i < 12; i++) {
    await call(
      handler,
      "POST",
      "/api/feedback",
      payload({ delta: -1, eventId: uuid(200 + i) }),
    );
  }
  const weights = await readJson(await call(handler, "GET", "/api/weights"));
  const entry = (weights.weights as Record<string, { weight: number }>)[DOMAIN];
  assertEquals(entry.weight, -10, "权重下限 -10");
});

Deno.test("KV：事件 key 带 ~30 天过期，权重 key 不带过期", async () => {
  const { handler, kv } = makeHarness();
  await call(handler, "POST", "/api/feedback", payload({ eventId: uuid(4) }));

  const eventEntry = kv.peek(["event", uuid(4)]);
  assert(eventEntry !== undefined, "事件回执应写入 KV");
  assertEquals(eventEntry.expireIn, 30 * 24 * 60 * 60 * 1000, "事件 TTL");

  const weightEntry = kv.peek(["weight", DOMAIN]);
  assert(weightEntry !== undefined, "权重应写入 KV");
  assertEquals(weightEntry.expireIn, undefined, "权重不应带 TTL");
  assertEquals(kv.countEventKeys(), 1, "应只有一个事件 key");
});

// --------------------------------------------------------------- GET weights

Deno.test("GET /api/weights：返回权重与 updatedAt", async () => {
  const { handler } = makeHarness();
  await call(handler, "POST", "/api/feedback", payload({ eventId: uuid(5) }));

  const res = await call(handler, "GET", "/api/weights");
  assertEquals(res.status, 200, "status");
  const body = await readJson(res);
  assertEquals(body.ok, true, "ok");
  const entry =
    (body.weights as Record<string, { weight: number; updatedAt: string }>)[
      DOMAIN
    ];
  assertEquals(entry.weight, 1, "weight");
  assertEquals(entry.updatedAt, new Date(NOW_MS).toISOString(), "updatedAt");
});

Deno.test("GET /api/weights：只返回 ALLOWED_DOMAINS 内的领域", async () => {
  const { handler } = makeHarnessWithEnv({
    FEEDBACK_KEY: KEY,
    ALLOWED_DOMAINS: "ai-embedded, edge-ai",
  });
  const body = await readJson(await call(handler, "GET", "/api/weights"));
  const weights = body.weights as Record<string, { weight: number }>;
  assertEquals(
    Object.keys(weights).sort(),
    ["ai-embedded", "edge-ai"],
    "domains",
  );
  assertEquals(weights["edge-ai"].weight, 0, "未使用领域权重为 0");
});

// ----------------------------------------------------------------- requests

Deno.test("参数：非白名单领域返回 400", async () => {
  const { handler } = makeHarness();
  const res = await call(
    handler,
    "POST",
    "/api/feedback",
    payload({ domain: "hack" }),
  );
  assertEquals(res.status, 400, "status");
  assertEquals((await readJson(res)).error, "invalid domain", "error");
});

Deno.test("参数：delta 只接受 +1 / -1", async () => {
  const { handler } = makeHarness();
  for (const delta of [2, 0, -2, "1", 1.5, null]) {
    const res = await call(
      handler,
      "POST",
      "/api/feedback",
      payload({ delta }),
    );
    assertEquals(res.status, 400, `delta=${JSON.stringify(delta)} status`);
    assertEquals(
      (await readJson(res)).error,
      "invalid delta",
      `delta=${JSON.stringify(delta)} error`,
    );
  }
});

Deno.test("参数：日期格式非法返回 400", async () => {
  const { handler } = makeHarness();
  for (const date of ["2026/11/14", "20261114", "2026-13-01", ""]) {
    const res = await call(handler, "POST", "/api/feedback", payload({ date }));
    assertEquals(res.status, 400, `date=${date} status`);
    assertEquals(
      (await readJson(res)).error,
      "invalid date",
      `date=${date} error`,
    );
  }
});

Deno.test("参数：不存在的日历日期（2026-02-30）返回 400", async () => {
  const { handler } = makeHarness();
  const res = await call(
    handler,
    "POST",
    "/api/feedback",
    payload({ date: "2026-02-30" }),
  );
  assertEquals(res.status, 400, "status");
});

Deno.test("参数：年份超出合理范围返回 400", async () => {
  const { handler } = makeHarness();
  for (const date of ["2019-01-01", "2099-01-01"]) {
    const res = await call(handler, "POST", "/api/feedback", payload({ date }));
    assertEquals(res.status, 400, `date=${date} status`);
  }
});

Deno.test("参数：eventId 必须是 UUID", async () => {
  const { handler } = makeHarness();
  for (
    const eventId of ["abc", "", 123, "00000000-0000-4000-8000-00000000000"]
  ) {
    const res = await call(
      handler,
      "POST",
      "/api/feedback",
      payload({ eventId }),
    );
    assertEquals(res.status, 400, `eventId=${String(eventId)} status`);
    assertEquals(
      (await readJson(res)).error,
      "invalid eventId",
      `eventId=${String(eventId)} error`,
    );
  }
});

Deno.test("请求体：非法 JSON 返回 400", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/feedback", "{not json");
  assertEquals(res.status, 400, "status");
  assertEquals((await readJson(res)).error, "invalid JSON", "error");
});

Deno.test("请求体：非对象 JSON（数组）返回 400", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/feedback", [1, 2, 3]);
  assertEquals(res.status, 400, "status");
});

Deno.test("请求体：超过 4KB 返回 413", async () => {
  const { handler } = makeHarness();
  const huge = payload({ padding: "x".repeat(5000) });
  const res = await call(handler, "POST", "/api/feedback", huge);
  assertEquals(res.status, 413, "status");
  assertEquals((await readJson(res)).error, "request body too large", "error");
});

Deno.test("方法：GET /api/feedback 返回 405", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "GET", "/api/feedback", undefined, {
    key: KEY,
  });
  assertEquals(res.status, 405, "status");
});

Deno.test("方法：POST /api/weights 返回 405", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/weights", {});
  assertEquals(res.status, 405, "status");
});

Deno.test("路由：未知路径返回 404", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "GET", "/nope");
  assertEquals(res.status, 404, "status");
  assertEquals((await readJson(res)).error, "not found", "error");
});

// --------------------------------------------------------------------- CORS

Deno.test("CORS：允许的来源回显 Access-Control-Allow-Origin", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "POST", "/api/feedback", payload(), {
    headers: { Origin: "https://yth-beep.github.io" },
  });
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "https://yth-beep.github.io",
    "ACAO",
  );
  assertEquals(res.headers.get("Vary"), "Origin", "Vary");
  assertIncludes(
    res.headers.get("Access-Control-Allow-Headers") ?? "",
    "X-Feedback-Key",
    "允许的请求头",
  );
});

Deno.test("CORS：本地开发地址放行", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "GET", "/health", undefined, {
    key: null,
    headers: { Origin: "http://localhost:8000" },
  });
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:8000",
    "ACAO",
  );
});

Deno.test("CORS：未授权来源不返回 ACAO", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "GET", "/health", undefined, {
    key: null,
    headers: { Origin: "https://evil.example" },
  });
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    null,
    "ACAO 应为空",
  );
});

Deno.test("CORS：OPTIONS 预检返回 204 且带允许头", async () => {
  const { handler } = makeHarness();
  const res = await call(handler, "OPTIONS", "/api/feedback", undefined, {
    key: null,
    headers: { Origin: "https://yth-beep.github.io" },
  });
  assertEquals(res.status, 204, "status");
  assertEquals(
    res.headers.get("Access-Control-Allow-Origin"),
    "https://yth-beep.github.io",
    "ACAO",
  );
  assertIncludes(
    res.headers.get("Access-Control-Allow-Methods") ?? "",
    "POST",
    "允许的方法",
  );
});

// ------------------------------------------------------------- failure modes

Deno.test("冲突：原子提交持续失败时有限重试后返回 409（不静默丢数据）", async () => {
  const { handler, kv } = makeHarness();
  kv.failCommits = true;
  const res = await call(handler, "POST", "/api/feedback", payload());
  assertEquals(res.status, 409, "status");
  assertEquals((await readJson(res)).error, "conflict, please retry", "error");
  assertEquals(
    kv.commits,
    MAX_COMMIT_ATTEMPTS,
    "重试次数应为上限，不能无限重试",
  );

  const weights = await readJson(await call(handler, "GET", "/api/weights"));
  const entry = (weights.weights as Record<string, { weight: number }>)[DOMAIN];
  assertEquals(entry.weight, 0, "失败时权重不得被写入");
});

Deno.test("异常：KV 抛错返回 500，且不泄漏异常栈", async () => {
  const brokenKv: KvLike = {
    get: () =>
      Promise.reject(new Error("boom: internal stack detail /x/y.ts:42")),
    atomic: () => {
      throw new Error("boom: atomic");
    },
  };
  const handler = createHandler({
    kv: brokenKv,
    env: (name: string) => (name === "FEEDBACK_KEY" ? KEY : undefined),
    now: () => NOW_MS,
  });
  const res = await call(handler, "POST", "/api/feedback", payload());
  assertEquals(res.status, 500, "status");
  const text = await res.text();
  assertExcludes(text, "boom", "不得泄漏异常信息");
  assertExcludes(text, "x/y.ts", "不得泄漏文件路径");
  assertExcludes(text, KEY, "不得泄漏密钥");
  assertEquals(JSON.parse(text).error, "internal error", "error");
});
