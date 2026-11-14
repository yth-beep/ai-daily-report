/**
 * Deno Deploy backend: weight feedback store (PRIMARY backend).
 *
 * Same HTTP contract as `backend/` (Cloudflare Worker), which stays as a
 * fallback. A static report page calls this directly so the reader never has
 * to log into GitHub to adjust a topic's weight.
 *
 * Endpoints:
 *   GET  /health        -> { ok:true, version }              (no key)
 *   POST /api/feedback  -> apply one +1 / -1 delta            (X-Feedback-Key)
 *   GET  /api/weights   -> current cumulative weights          (X-Feedback-Key)
 *
 * Deno KV layout (keys are separate, never mixed):
 *   ["weight", <domain>] -> { weight: <int -10..10>, updatedAt: <ISO> }
 *   ["event",  <uuid>]   -> { domain, delta, at }   (TTL ~30 days, idempotency)
 *
 * Consistency: every write is one atomic commit that checks BOTH
 *   - the weight entry's versionstamp (no lost update), and
 *   - that the event key still does not exist (same eventId applies once).
 * On a commit conflict the request re-reads and retries a bounded number of
 * times; if it still cannot commit it returns 409 instead of silently
 * dropping the delta.
 *
 * Privacy: no IP, User-Agent, Cookie or any personal data is stored.
 *
 * Env vars (set as Deno Deploy secrets/vars, never in the repo):
 *   FEEDBACK_KEY     shared key compared against X-Feedback-Key (empty => 401)
 *   ALLOWED_DOMAINS  comma-separated enabled topic ids, default "ai-embedded"
 */

const VERSION = "1.0.0";
const MAX_BODY_BYTES = 4096;
const WEIGHT_MIN = -10;
const WEIGHT_MAX = 10;
const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAX_COMMIT_ATTEMPTS = 5;

/** GitHub Pages origin, plus local development origins. */
const ALLOWED_ORIGINS: readonly string[] = [
  "https://yth-beep.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

// --------------------------------------------------------------------------
// Minimal structural types so tests can inject an in-memory KV.
// --------------------------------------------------------------------------

export interface AtomicCheckLike {
  key: Deno.KvKey;
  versionstamp: string | null;
}

export interface AtomicLike {
  check(...checks: AtomicCheckLike[]): AtomicLike;
  set(
    key: Deno.KvKey,
    value: unknown,
    options?: { expireIn?: number },
  ): AtomicLike;
  commit(): Promise<{ ok: boolean }>;
}

export interface KvLike {
  get<T = unknown>(key: Deno.KvKey): Promise<Deno.KvEntryMaybe<T>>;
  atomic(): AtomicLike;
}

export interface HandlerOptions {
  kv: KvLike;
  /** Env reader; defaults to `Deno.env.get`. Tests inject a plain object. */
  env?: (name: string) => string | undefined;
  /** Clock injection for deterministic date-range checks. */
  now?: () => number;
  /** Extra allowed CORS origins (preview deployments). */
  extraOrigins?: readonly string[];
}

interface StoredWeight {
  weight: number;
  updatedAt: string;
}

interface ReadWeight {
  weight: number;
  updatedAt: string | null;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function error(
  status: number,
  message: string,
  cors: Record<string, string> = {},
): Response {
  return json({ ok: false, error: message }, status, cors);
}

function corsHeaders(
  request: Request,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!allowed.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Feedback-Key",
    "Access-Control-Max-Age": "86400",
  };
}

/** Length-independent comparison (no early exit on content mismatch). */
function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseAllowedDomains(raw: string | undefined): string[] {
  const list = (raw ?? "ai-embedded")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ["ai-embedded"];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

function inReasonableRange(value: string, nowMs: number): boolean {
  const year = Number(value.slice(0, 4));
  const nowYear = new Date(nowMs).getUTCFullYear();
  return year >= 2024 && year <= nowYear + 1;
}

function parseWeight(value: unknown): ReadWeight {
  if (typeof value !== "object" || value === null) {
    return { weight: 0, updatedAt: null };
  }
  const rec = value as Partial<StoredWeight>;
  const weight = typeof rec.weight === "number" && Number.isFinite(rec.weight)
    ? Math.trunc(rec.weight)
    : 0;
  const updatedAt = typeof rec.updatedAt === "string" ? rec.updatedAt : null;
  return { weight, updatedAt };
}

function clamp(value: number): number {
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, value));
}

// --------------------------------------------------------------------------
// Handler factory
// --------------------------------------------------------------------------

export function createHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  const kv = options.kv;
  const readEnv = options.env ?? ((name: string) => Deno.env.get(name));
  const now = options.now ?? (() => Date.now());
  const allowedOrigins = new Set<string>([
    ...ALLOWED_ORIGINS,
    ...(options.extraOrigins ?? []),
  ]);

  const allowedDomains = () => parseAllowedDomains(readEnv("ALLOWED_DOMAINS"));

  function authorized(request: Request): boolean {
    const expected = (readEnv("FEEDBACK_KEY") ?? "").trim();
    if (expected === "") return false; // unconfigured backend never authorizes
    const given = (request.headers.get("X-Feedback-Key") ?? "").trim();
    return safeEqual(given, expected);
  }

  async function handleFeedback(
    request: Request,
    cors: Record<string, string>,
  ): Promise<Response> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return error(413, "request body too large", cors);
    }

    let text: string;
    try {
      text = await request.text();
    } catch {
      return error(400, "invalid body", cors);
    }
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return error(413, "request body too large", cors);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return error(400, "invalid JSON", cors);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return error(400, "invalid JSON", cors);
    }

    const payload = body as Record<string, unknown>;
    const domain = payload.domain;
    const delta = payload.delta;
    const date = payload.date;
    const eventId = payload.eventId;

    if (typeof domain !== "string" || !allowedDomains().includes(domain)) {
      return error(400, "invalid domain", cors);
    }
    if (delta !== 1 && delta !== -1) {
      return error(400, "invalid delta", cors);
    }
    if (!isValidDate(date) || !inReasonableRange(date, now())) {
      return error(400, "invalid date", cors);
    }
    if (!isUuid(eventId)) {
      return error(400, "invalid eventId", cors);
    }

    const weightKey: Deno.KvKey = ["weight", domain];
    const eventKey: Deno.KvKey = ["event", eventId];

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const [weightEntry, eventEntry] = await Promise.all([
        kv.get<StoredWeight>(weightKey),
        kv.get<unknown>(eventKey),
      ]);

      const current = parseWeight(weightEntry.value);

      // Replay of an already applied event: report the current weight, no write.
      if (eventEntry.value !== null && eventEntry.value !== undefined) {
        return json(
          {
            ok: true,
            idempotent: true,
            domain,
            weight: current.weight,
            updatedAt: current.updatedAt,
          },
          200,
          cors,
        );
      }

      const nextWeight = clamp(current.weight + delta);
      const updatedAt = new Date(now()).toISOString();

      const commit = await kv.atomic()
        .check({ key: weightKey, versionstamp: weightEntry.versionstamp })
        .check({ key: eventKey, versionstamp: null })
        .set(
          weightKey,
          { weight: nextWeight, updatedAt } satisfies StoredWeight,
        )
        .set(eventKey, { domain, delta, at: updatedAt }, {
          expireIn: EVENT_TTL_MS,
        })
        .commit();

      if (commit.ok) {
        return json(
          { ok: true, domain, delta, weight: nextWeight, updatedAt },
          200,
          cors,
        );
      }
      // Conflict: another writer changed the weight, or wrote this eventId
      // first. Loop re-reads both keys and either applies or reports idempotent.
    }

    return error(409, "conflict, please retry", cors);
  }

  async function handleWeights(
    cors: Record<string, string>,
  ): Promise<Response> {
    const weights: Record<string, ReadWeight> = {};
    for (const domain of allowedDomains()) {
      const entry = await kv.get<StoredWeight>(["weight", domain]);
      weights[domain] = parseWeight(entry.value);
    }
    return json({ ok: true, weights }, 200, cors);
  }

  return async function handler(request: Request): Promise<Response> {
    const cors = corsHeaders(request, allowedOrigins);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      const path = new URL(request.url).pathname;

      if (path === "/health") {
        if (request.method !== "GET") {
          return error(405, "method not allowed", cors);
        }
        return json({ ok: true, version: VERSION }, 200, cors);
      }

      if (path === "/api/feedback") {
        if (request.method !== "POST") {
          return error(405, "method not allowed", cors);
        }
        if (!authorized(request)) return error(401, "unauthorized", cors);
        return await handleFeedback(request, cors);
      }

      if (path === "/api/weights") {
        if (request.method !== "GET") {
          return error(405, "method not allowed", cors);
        }
        if (!authorized(request)) return error(401, "unauthorized", cors);
        return await handleWeights(cors);
      }

      return error(404, "not found", cors);
    } catch {
      // Never leak exception text / stack traces to the client.
      return error(500, "internal error", cors);
    }
  };
}

// --------------------------------------------------------------------------
// Deno Deploy / local entrypoint
// --------------------------------------------------------------------------

if (import.meta.main) {
  const kv = await Deno.openKv();
  Deno.serve(createHandler({ kv }));
}
