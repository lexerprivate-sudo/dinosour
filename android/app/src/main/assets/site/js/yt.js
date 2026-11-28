/* Live YouTube search, suggestions and metadata (served by /api/*). */

const memory = new Map();
const pending = new Map();
const MEMORY_TTL = 2 * 60 * 1000;
const SEARCH_TIMEOUT = 8000;
const SUGGEST_TIMEOUT = 4000;

function cacheGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMORY_TTL) {
    memory.delete(key);
    return null;
  }
  // Refresh recency so hot entries survive eviction.
  memory.delete(key);
  memory.set(key, hit);
  return hit.value;
}

/* One in-flight request per key: typing, focus and route transitions used to
   fire the same search several times concurrently. */
function dedupe(key, fn) {
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(fn).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

function cacheSet(key, value) {
  if (memory.size > 60) memory.delete(memory.keys().next().value);
  memory.set(key, { at: Date.now(), value });
}

async function getJson(url, { timeout = SEARCH_TIMEOUT, signal } = {}) {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* handled below */
    }
    if (!res.ok || !data) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function searchYouTube(query, { continuation = '', signal } = {}) {
  const q = String(query || '').trim();
  if (!q && !continuation) return { videos: [], channels: [], continuation: null };

  const key = `${q.toLowerCase()}|${continuation}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  return dedupe(`search:${key}`, async () => {
    const params = new URLSearchParams({ q, continuation });
    const data = await getJson(`/api/search?${params}`, { signal });
    if (!Array.isArray(data.videos)) throw new Error('Unexpected search response');

    const value = { ...data, videos: data.videos, channels: data.channels || [] };
    cacheSet(key, value);
    return value;
  });
}

export async function suggestYouTube(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `suggest:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  return dedupe(key, async () => {
    const data = await getJson(`/api/suggest?q=${encodeURIComponent(q)}`, {
      timeout: SUGGEST_TIMEOUT,
      signal,
    }).catch(() => null);
    const value = Array.isArray(data?.suggestions) ? data.suggestions : [];
    // Never cache an empty/failed response — a transient upstream failure
    // used to poison suggestions for the full TTL.
    if (value.length) cacheSet(key, value);
    return value;
  });
}

export async function videoInfo(id) {
  if (!id) return null;
  const key = `video:${id}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  return dedupe(key, async () => {
    const data = await getJson(`/api/video?id=${encodeURIComponent(id)}`, {
      timeout: 10000,
    }).catch(() => null);
    const value = data && data.id === id ? data : null;
    if (value) cacheSet(key, value);
    return value;
  });
}
