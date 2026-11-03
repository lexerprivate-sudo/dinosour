import { videoInfo } from '../_lib/youtube.js';
import { cachedJson } from '../_lib/http.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  if (!/^[\w-]{11}$/.test(id)) {
    return cachedJson(request, 0, async () => ({
      status: 400,
      body: { ok: false, error: 'Bad video id.' },
    }));
  }

  return cachedJson(request, 21600, async () => {
    const info = await videoInfo(id);
    if (!info) return { status: 404, body: { ok: false, error: 'Video not found.' } };
    return { body: info };
  });
}
