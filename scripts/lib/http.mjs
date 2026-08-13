/**
 * Minimal HTTP with pacing and backoff. No dependencies.
 *
 * Pacing matters more than it looks: the OpenDota free tier is ~60 requests/minute and we
 * deliberately do not use an API key (Phase 0.7 measured the free tier as sufficient for
 * TI's ~15 matches/day). A burst that trips 429 costs more time than the pacing does.
 */

const UA = 'ti2026-fantasy-data/0.1 (+https://github.com/serhii-zashchyk)';

let lastCall = 0;

/** Sleep until at least `gapMs` has passed since the previous paced call. */
async function pace(gapMs) {
  const wait = gapMs - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/**
 * GET JSON with retry. Retries 429/5xx and network errors; does NOT retry 4xx,
 * because a 404 on a match is a real answer (routine — see the retry stub in ingest).
 */
export async function getJson(url, { gapMs = 1100, attempts = 5, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await pace(gapMs);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (r.ok) return await r.json();

      if (r.status === 429 || r.status >= 500) {
        const back = Math.min(30000, 2000 * 2 ** i);
        console.warn(`  ${r.status} from ${new URL(url).pathname} — retry in ${back}ms`);
        await new Promise((res) => setTimeout(res, back));
        lastErr = new Error(`HTTP ${r.status}`);
        continue;
      }
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      throw err; // 4xx other than 429: a real answer, surface it
    } catch (e) {
      if (e.status) throw e;
      lastErr = e;
      const back = Math.min(30000, 2000 * 2 ** i);
      console.warn(`  network error (${e.message}) — retry in ${back}ms`);
      await new Promise((res) => setTimeout(res, back));
    }
  }
  throw lastErr ?? new Error(`gave up on ${url}`);
}
