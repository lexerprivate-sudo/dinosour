// Shared JSON response helpers for the Pages Functions.

export function json(body, { status = 200, maxAge = 0 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : 'no-store',
    },
  });
}

/** Serve from the edge cache when possible, otherwise run `build` and cache it. */
export async function cachedJson(request, maxAge, build) {
  const cache = globalThis.caches?.default;
  let cacheKey = null;
  if (cache) {
    cacheKey = new Request(request.url, { method: 'GET' });
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {
      /* cache is a bonus, never a requirement */
    }
  }

  const { body, status = 200 } = await build();
  const response = json(body, { status, maxAge: status === 200 ? maxAge : 0 });

  if (cache && cacheKey && status === 200) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      /* ignore cache write failures */
    }
  }
  return response;
}
