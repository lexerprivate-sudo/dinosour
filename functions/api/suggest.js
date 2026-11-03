import { suggestYouTube } from '../_lib/youtube.js';
import { cachedJson } from '../_lib/http.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return cachedJson(request, 0, async () => ({ body: { suggestions: [] } }));

  return cachedJson(request, 3600, async () => ({
    body: { suggestions: await suggestYouTube(q).catch(() => []) },
  }));
}
