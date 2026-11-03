// YouTube search / metadata via YouTube's public InnerTube API.
//
// No API key is needed: this is the same JSON endpoint youtube.com's own web
// client uses. It is called from the server (Node locally, a Pages Function on
// Cloudflare) so the browser never has to fight CORS.

const INNERTUBE = 'https://www.youtube.com/youtubei/v1';
const SUGGEST = 'https://suggestqueries.google.com/complete/search';

const CLIENT = {
  clientName: 'WEB',
  clientVersion: '2.20240910.00.00',
  hl: 'en',
  gl: 'US',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const TIMEOUT_MS = 12000;

function context() {
  return {
    client: {
      ...CLIENT,
      originalUrl: 'https://www.youtube.com/',
      platform: 'DESKTOP',
    },
  };
}

async function request(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9',
      origin: 'https://www.youtube.com',
      referer: 'https://www.youtube.com/',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`YouTube responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function innertube(endpoint, body) {
  const res = await request(`${INNERTUBE}/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

/* -------------------------------------------------------------- parsing */

function text(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.simpleText) return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((r) => r.text || '').join('');
  return '';
}

function lastThumb(value) {
  const list = value?.thumbnails;
  return Array.isArray(list) && list.length ? list[list.length - 1].url : '';
}

function secondsFromLength(label) {
  if (!label) return 0;
  const parts = label.split(':').map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
    } else if (value && typeof value === 'object') {
      walk(value, visit);
    }
  }
}

function normalizeVideo(r) {
  if (!r?.videoId) return null;
  const snippets = r.detailedMetadataSnippets?.[0]?.snippetText;
  const shortsOverlay = (r.thumbnailOverlays || []).some(
    (o) => o.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS'
  );
  const length = text(r.lengthText);
  return {
    id: r.videoId,
    title: text(r.title) || 'Untitled video',
    channel: text(r.ownerText) || text(r.longBylineText) || 'YouTube',
    channelId: r.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '',
    viewsText: text(r.viewCountText),
    publishedText: text(r.publishedTimeText),
    length,
    lengthSeconds: secondsFromLength(length),
    thumb: `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
    description: text(snippets),
    isShort: shortsOverlay || (!length && !!r.thumbnailOverlays?.length),
  };
}

function parseSearch(data) {
  const videos = [];
  const channels = [];
  const seenVideos = new Set();
  const seenChannels = new Set();
  let continuation = '';

  walk(data, (node) => {
    if (node.videoRenderer) {
      const v = normalizeVideo(node.videoRenderer);
      if (v && !seenVideos.has(v.id)) {
        seenVideos.add(v.id);
        videos.push(v);
      }
    } else if (node.channelRenderer?.channelId) {
      const c = node.channelRenderer;
      if (!seenChannels.has(c.channelId)) {
        seenChannels.add(c.channelId);
        channels.push({
          id: c.channelId,
          title: text(c.title) || 'YouTube channel',
          subscribersText: text(c.videoCountText) || text(c.subscriberCountText),
          videoCountText: text(c.videoCountText),
          thumb: lastThumb(c.thumbnail),
          handle: text(c.subscriberCountText)?.startsWith('@') ? text(c.subscriberCountText) : '',
        });
      }
    } else if (!continuation && node.continuationCommand?.token) {
      continuation = node.continuationCommand.token;
    }
  });

  return { videos, channels, continuation: continuation || null };
}

/* -------------------------------------------------------------- public */

export async function searchYouTube(query, { continuation } = {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (!continuation && !q) return { query: q, videos: [], channels: [], continuation: null };

  const body = continuation
    ? { context: context(), continuation }
    : { context: context(), query: q, params: 'EgIQAQ%3D%3D' };

  const data = await innertube('search', body);
  const parsed = parseSearch(data);
  return { query: q, ...parsed, source: 'youtube' };
}

export async function suggestYouTube(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return [];
  const url = `${SUGGEST}?client=firefox&ds=yt&hl=en&q=${encodeURIComponent(q)}`;
  const res = await request(url);
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.[1]) ? parsed[1] : [];
    return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].slice(0, 10);
  } catch {
    return [];
  }
}

export async function videoInfo(id) {
  const videoId = String(id || '').trim();
  if (!/^[\w-]{11}$/.test(videoId)) return null;

  const data = await innertube('player', { context: context(), videoId });
  const d = data.videoDetails || {};
  if (!d.videoId) return null;

  const status = data.playabilityStatus?.status || 'UNKNOWN';
  const formats = data.streamingData?.adaptiveFormats || [];
  const hasAudio = formats.some((f) => f.audioQuality) || !!data.streamingData?.formats?.length;
  const micro = data.microformat?.playerMicroformatRenderer || {};

  return {
    id: d.videoId,
    title: d.title || 'YouTube video',
    channel: d.author || 'YouTube',
    channelId: d.channelId || '',
    viewsText: d.viewCount ? `${Number(d.viewCount).toLocaleString('en-US')} views` : '',
    published: micro.publishDate || micro.uploadDate || '',
    publishedText: '',
    length: '',
    lengthSeconds: Number(d.lengthSeconds) || 0,
    thumb: `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`,
    description: d.shortDescription || '',
    keywords: Array.isArray(d.keywords) ? d.keywords.slice(0, 12) : [],
    playable: status === 'OK' || status === 'LIVE_STREAM_OFFLINE',
    hasAudio,
    status,
    source: 'youtube',
  };
}

/* ------------------------------------------------------- Piped fallback */

const PIPED_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
];

function pipedVideo(item) {
  const id = (item.url || '').split('v=')[1] || '';
  if (!id) return null;
  return {
    id,
    title: item.title || 'Untitled video',
    channel: item.uploaderName || 'YouTube',
    channelId: (item.uploaderUrl || '').split('/channel/')[1] || '',
    viewsText: item.views >= 0 ? `${Number(item.views).toLocaleString('en-US')} views` : '',
    publishedText: item.uploadedDate || '',
    length: item.duration >= 0 ? formatDuration(item.duration) : '',
    lengthSeconds: item.duration > 0 ? item.duration : 0,
    thumb: item.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: item.shortDescription || '',
    isShort: item.duration > 0 && item.duration <= 60,
  };
}

function formatDuration(total) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export async function searchFallback(query, { continuation } = {}) {
  if (continuation) return { query, videos: [], channels: [], continuation: null, source: 'fallback' };
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return { query: q, videos: [], channels: [], continuation: null, source: 'fallback' };

  for (const base of PIPED_INSTANCES) {
    try {
      const res = await request(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, {
        headers: { accept: 'application/json' },
      });
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      return {
        query: q,
        videos: items.map(pipedVideo).filter(Boolean),
        channels: [],
        continuation: data.nextpage ? String(data.nextpage) : null,
        source: 'fallback',
      };
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

/** Search with a fallback mirror. Returns null only when every source fails. */
export async function searchAll(query, options = {}) {
  try {
    return await searchYouTube(query, options);
  } catch {
    return await searchFallback(query, options);
  }
}
