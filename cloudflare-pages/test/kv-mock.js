/**
 * In-memory stand-in for the Workers KV binding used by the Pages Functions.
 *
 * Mirrors the parts of the KV API the handler relies on:
 *   get(key) -> string | null
 *   put(key, value, { expirationTtl })
 *   delete(key)
 *
 * It can also simulate a losing read-modify-write (see `clobbersLeft`) so the
 * retry path is testable without a real Cloudflare account.
 */
export class MockKV {
  #store = new Map();

  /** Every put() call, in order: { key, value, expirationTtl }. */
  putLog = [];
  /** How many upcoming put() calls should be overwritten by a stale writer. */
  clobbersLeft = 0;
  /** Only puts whose key starts with this prefix are clobbered. */
  clobberPrefix = "";
  /** When true every get() throws (used for the 500-path test). */
  broken = false;

  async get(key) {
    if (this.broken) throw new Error("boom: kv get failed at handler.js:42");
    return this.#store.has(key) ? this.#store.get(key) : null;
  }

  async put(key, value, options = {}) {
    if (this.broken) throw new Error("boom: kv put failed at handler.js:43");
    const previous = this.#store.has(key) ? this.#store.get(key) : null;
    this.#store.set(key, value);
    this.putLog.push({ key, value, expirationTtl: options?.expirationTtl });

    if (this.clobbersLeft > 0 && key.startsWith(this.clobberPrefix)) {
      this.clobbersLeft -= 1;
      // A concurrent request that read the old base writes it back.
      if (previous === null) this.#store.delete(key);
      else this.#store.set(key, previous);
    }
  }

  async delete(key) {
    this.#store.delete(key);
  }

  /** Raw value for assertions. */
  peek(key) {
    return this.#store.has(key) ? this.#store.get(key) : null;
  }

  /** Direct write, simulating another writer (no putLog entry). */
  setRaw(key, value) {
    this.#store.set(key, value);
  }

  keys() {
    return [...this.#store.keys()];
  }
}
