/**
 * Cloudflare Worker: weight feedback backend.
 *
 * Replaces the old GitHub Issue flow. A report page calls this directly so the
 * user never has to log into GitHub to adjust a topic's weight.
 *
 * Endpoints:
 *   GET  /health        -> { ok:true, version }          (no key)
 *   POST /api/feedback  -> apply a +1 / -1 delta          (X-Feedback-Key)
 *   GET  /api/weights   -> current cumulative weights     (X-Feedback-Key)
 *
 * KV layout (namespace bound as WEIGHTS_KV):
 *   weight:<domain>  -> JSON { "weight": <int>, "updatedAt": "<ISO>" }
 *   event:<eventId>  -> "1"  (idempotency receipt, TTL 30 days)
 *
 * Privacy: no IP, User-Agent, Cookie or personal data is ever stored.
 *
 * Secrets / vars (set via `wrangler secret put` / [vars]):
 *   FEEDBACK_KEY     (secret)  shared key checked against X-Feedback-Key.
 *   ALLOWED_DOMAINS  (var)     comma-separated enabled topic ids, e.g. "ai-embedded".
 */

const VERSION = "1.0.0";
const MAX_BODY_BYTES = 4096;
const WEIGHT_MIN = -10;
const WEIGHT_MAX = 10;
const EVENT_TTL_SECONDS = 30 * 24 * 3600; // 30 days

// CORS allowed origins. Local dev addresses are for `wrangler dev`.
const ALLOWED_ORIGINS = [
  "https://yth-beep.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function error(status, message) {
  return json({ ok: false, error: message }, status);
}

function allowedDomains(env) {
  const raw = (env.ALLOWED_DOMAINS || "ai-embedded").trim();
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Feedback-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function authorized(request, env) {
  const key = (request.headers.get("X-Feedback-Key") || "").trim();
  const expected = (env.FEEDBACK_KEY || "").trim();
  return expected !== "" && key === expected;
}

function isUuid(str) {
  return typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isValidDate(str) {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function inReasonableRange(str) {
  const year = new Date(str + "T00:00:00Z").getUTCFullYear();
  const nowYear = new Date().getUTCFullYear();
  return year >= 2024 && year <= nowYear + 1;
}

async function handleFeedback(request, env, cors) {
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
    return error(400, "request body too large");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "invalid JSON");
  }
  if (typeof body !== "object" || body === null) return error(400, "invalid JSON");

  const { domain, delta, date, eventId } = body;

  if (!allowedDomains(env).includes(domain)) return error(400, "invalid domain");
  if (delta !== 1 && delta !== -1) return error(400, "invalid delta");
  if (!isValidDate(date) || !inReasonableRange(date)) return error(400, "invalid date");
  if (!isUuid(eventId)) return error(400, "invalid eventId");

  const kv = env.WEIGHTS_KV;
  const eventKey = `event:${eventId}`;

  // Idempotency: same eventId only ever applies once.
  const existing = await kv.get(eventKey);
  if (existing !== null && existing !== undefined) {
    const weightKey = `weight:${domain}`;
    const w = await readWeight(kv, weightKey);
    return json({ ok: true, idempotent: true, domain, weight: w.weight }, 200, cors);
  }

  const weightKey = `weight:${domain}`;
  const current = await readWeight(kv, weightKey);
  const next = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, current.weight + delta));
  const updatedAt = new Date().toISOString();

  await kv.put(weightKey, JSON.stringify({ weight: next, updatedAt }));
  await kv.put(eventKey, "1", { expirationTtl: EVENT_TTL_SECONDS });

  return json({ ok: true, domain, delta, weight: next, updatedAt }, 200, cors);
}

async function readWeight(kv, weightKey) {
  const raw = await kv.get(weightKey);
  if (raw === null || raw === undefined) return { weight: 0, updatedAt: null };
  try {
    const parsed = JSON.parse(raw);
    const weight = Number.isFinite(parsed.weight) ? parsed.weight : 0;
    return { weight, updatedAt: parsed.updatedAt || null };
  } catch {
    return { weight: 0, updatedAt: null };
  }
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

export async function handleRequest(request, env) {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const path = new URL(request.url).pathname;

  if (path === "/health") {
    if (request.method !== "GET") return error(405, "method not allowed");
    return json({ ok: true, version: VERSION }, 200, cors);
  }

  if (path === "/api/feedback") {
    if (request.method !== "POST") return error(405, "method not allowed");
    if (!authorized(request, env)) return error(401, "unauthorized");
    return await handleFeedback(request, env, cors);
  }

  if (path === "/api/weights") {
    if (request.method !== "GET") return error(405, "method not allowed");
    if (!authorized(request, env)) return error(401, "unauthorized");
    return await handleWeights(env, cors);
  }

  return error(404, "not found");
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
