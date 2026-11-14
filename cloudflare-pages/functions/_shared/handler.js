/**
 * Cloudflare Pages Functions: weight feedback backend (PRIMARY backend).
 *
 * Same HTTP contract and the SAME KV namespace layout as `backend/`
 * (Cloudflare Worker) and `backend-deno/`, so switching backends only means
 * changing `apiUrl` in docs/assets/feedback-config.js.
 *
 *   GET  /health        -> { ok:true, version }            (no key)
 *   POST /api/feedback  -> apply one +1 / -1 delta         (X-Feedback-Key)
 *   GET  /api/weights   -> current cumulative weights       (X-Feedback-Key)
 *
 * KV layout (namespace bound as WEIGHTS_KV, shared with the Worker):
 *   weight:<domain>  -> JSON { "weight": <int -10..10>, "updatedAt": "<ISO>" }
 *   event:<eventId>  -> "1"   (idempotency receipt, expirationTtl 30 days)
 *
 * Concurrency boundary (important, KV has no compare-and-swap):
 *   - Same eventId is rejected before writing the weight, so a double click or
 *     a client retry can never be counted twice in practice.
 *   - The event receipt is written BEFORE the weight so a crash cannot double
 *     apply; if the weight write ultimately fails the receipt is deleted so the
 *     client can retry the same eventId.
 *   - Different eventIds arriving in the same millisecond can still overwrite
 *     each other (classic KV read-modify-write). We write, read back, and retry
 *     up to MAX_WRITE_ATTEMPTS; if the counter still does not converge we
 *     return 409 instead of pretending success. See README for the exact
 *     guarantee and the Durable Object / D1 alternative.
 *
 * Privacy: no IP, User-Agent, Cookie or personal data is stored.
 *
 * Env:
 *   WEIGHTS_KV       KV namespace binding (required)
 *   FEEDBACK_KEY     secret; empty/unset => every protected route returns 401
 *   ALLOWED_DOMAINS  comma-separated enabled topic ids, default "ai-embedded"
 */

export const VERSION = "1.0.0";
export const MAX_BODY_BYTES = 4096;
export const WEIGHT_MIN = -10;
export const WEIGHT_MAX = 10;
export const EVENT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const MAX_WRITE_ATTEMPTS = 3;

/** GitHub Pages origin + local development origins. */
const ALLOWED_ORIGINS = [
  "https://yth-beep.github.io",
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ helpers

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function error(status, message, cors = {}) {
  return json({ ok: false, error: message }, status, cors);
}

export function allowedDomains(env) {
  const raw = String(env.ALLOWED_DOMAINS ?? "").trim();
  const list = (raw === "" ? "ai-embedded" : raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ["ai-embedded"];
}

export function corsHeaders(request) {
  const origin = request.headers.get("Origin") ?? "";
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Feedback-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function authorized(request, env) {
  const expected = String(env.FEEDBACK_KEY ?? "").trim();
  if (expected === "") return false; // unconfigured backend never authorizes
  const given = (request.headers.get("X-Feedback-Key") ?? "").trim();
  return given.length === expected.length && given === expected;
}

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

function inReasonableRange(value, nowYear) {
  const year = Number(value.slice(0, 4));
  return year >= 2024 && year <= nowYear + 1;
}

function clamp(value) {
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, value));
}

export async function readWeight(kv, weightKey) {
  const raw = await kv.get(weightKey);
  if (raw === null || raw === undefined) return { weight: 0, updatedAt: null };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const weight = Number.isFinite(parsed?.weight) ? Math.trunc(parsed.weight) : 0;
    const updatedAt = typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null;
    return { weight, updatedAt };
  } catch {
    return { weight: 0, updatedAt: null };
  }
}

/**
 * Read-modify-write with bounded retry. Returns { ok:true, weight, updatedAt }
 * when the counter verifiably holds our delta, or { ok:false, weight } when it
 * could not converge (caller turns that into a 409).
 */
async function applyDelta(kv, weightKey, delta, nowIso) {
  let last = { weight: 0, updatedAt: null };

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const current = await readWeight(kv, weightKey);
    const next = clamp(current.weight + delta);
    const updatedAt = nowIso();

    await kv.put(weightKey, JSON.stringify({ weight: next, updatedAt }));

    // Read back: KV writes are visible to the writing colo right away, so a
    // different value means another request clobbered us.
    const after = await readWeight(kv, weightKey);

    if (after.weight === next) {
      return { ok: true, weight: next, updatedAt: after.updatedAt ?? updatedAt };
    }
    // Someone else already moved the counter further in our direction (their
    // write may have included our delta) -> treat as applied, do not add twice.
    if (delta > 0 && after.weight > next) {
      return { ok: true, weight: after.weight, updatedAt: after.updatedAt };
    }
    if (delta < 0 && after.weight < next) {
      return { ok: true, weight: after.weight, updatedAt: after.updatedAt };
    }

    // Our write was overwritten by a stale-base write: retry on the new base.
    last = after;
  }

  return { ok: false, weight: last.weight };
}

async function handleFeedback(request, env, cors) {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return error(413, "request body too large", cors);
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return error(400, "invalid body", cors);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return error(413, "request body too large", cors);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, "invalid JSON", cors);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return error(400, "invalid JSON", cors);
  }

  const { domain, delta, date, eventId } = body;

  if (typeof domain !== "string" || !allowedDomains(env).includes(domain)) {
    return error(400, "invalid domain", cors);
  }
  if (delta !== 1 && delta !== -1) {
    return error(400, "invalid delta", cors);
  }
  if (!isValidDate(date) || !inReasonableRange(date, new Date().getUTCFullYear())) {
    return error(400, "invalid date", cors);
  }
  if (!isUuid(eventId)) {
    return error(400, "invalid eventId", cors);
  }

  const kv = env.WEIGHTS_KV;
  const weightKey = `weight:${domain}`;
  const eventKey = `event:${eventId}`;

  // Idempotency first: a replayed eventId must never touch the counter.
  const existing = await kv.get(eventKey);
  if (existing !== null && existing !== undefined) {
    const w = await readWeight(kv, weightKey);
    return json(
      { ok: true, idempotent: true, domain, weight: w.weight, updatedAt: w.updatedAt },
      200,
      cors,
    );
  }

  // Receipt before counter: a crash between the two can only lose this delta,
  // never apply it twice.
  await kv.put(eventKey, "1", { expirationTtl: EVENT_TTL_SECONDS });

  const result = await applyDelta(kv, weightKey, delta, () => new Date().toISOString());
  if (!result.ok) {
    // Let the client retry with the same eventId.
    try {
      await kv.delete(eventKey);
    } catch {
      /* deleting the receipt is best effort */
    }
    return error(409, "conflict, please retry", cors);
  }

  return json(
    { ok: true, domain, delta, weight: result.weight, updatedAt: result.updatedAt },
    200,
    cors,
  );
}

async function handleWeights(env, cors) {
  const kv = env.WEIGHTS_KV;
  const weights = {};
  for (const domain of allowedDomains(env)) {
    const w = await readWeight(kv, `weight:${domain}`);
    weights[domain] = { weight: w.weight, updatedAt: w.updatedAt };
  }
  return json({ ok: true, weights }, 200, cors);
}

/**
 * Single entrypoint shared by every Pages Functions route.
 * Exported so tests can drive it without the Pages runtime.
 */
export async function handleRequest(request, env) {
  const cors = corsHeaders(request);

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const path = new URL(request.url).pathname;

    if (path === "/health") {
      if (request.method !== "GET") return error(405, "method not allowed", cors);
      return json({ ok: true, version: VERSION }, 200, cors);
    }

    if (path === "/api/feedback") {
      if (request.method !== "POST") return error(405, "method not allowed", cors);
      if (!authorized(request, env)) return error(401, "unauthorized", cors);
      return await handleFeedback(request, env, cors);
    }

    if (path === "/api/weights") {
      if (request.method !== "GET") return error(405, "method not allowed", cors);
      if (!authorized(request, env)) return error(401, "unauthorized", cors);
      return await handleWeights(env, cors);
    }

    return error(404, "not found", cors);
  } catch {
    // Never leak exception text / stack traces to the client.
    return error(500, "internal error", cors);
  }
}
