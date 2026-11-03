import { searchAll } from '../_lib/youtube.js';
import { cachedJson } from '../_lib/http.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const continuation = (url.searchParams.get('continuation') || '').trim();

  if (!q && !continuation) {
    return cachedJson(request, 0, async () => ({
      status: 400,
      body: { ok: false, error: 'Missing search query.' },
    }));
  }

  return cachedJson(request, 120, async () => {
    const result = await searchAll(q, { continuation });
    if (!result) {
      return {
        status: 502,
        body: { ok: false, error: 'Live YouTube search is unavailable right now.' },
      };
    }
    return { body: result };
  });
}
