/* Smart related / mix track selection.
 *
 * Searching the full current title ("Ramz - Barking (lyrics) | ...") makes
 * YouTube return the same song from ten different lyric channels. This module
 * extracts the song identity, searches several *different* related queries,
 * and drops near-duplicate tracks so a mix stays in the same genre without
 * repeating the same title.
 */

const NOISE = /\b(lyrics?|lyric|official|video|audio|music|slowed|reverb|sped|up|nightcore|remix|cover|karaoke|visualizer|visualiser|live|acoustic|full|album|hd|hq|4k|1080p|720p|cc|sub|español|english|version|by|the|from|with|feat|ft)\b/gi;

export function cleanTitle(title = '') {
  return String(title || '')
    .split(/\s*\|\s*/)[0]
    .replace(/[([][^\])]*[\])]/g, ' ')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(title) {
  return cleanTitle(title)
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && w.length < 18);
}

/** Sorted token set identity: "Ramz - Barking" == "Barking by Ramz Lyrics". */
export function trackKey(title = '') {
  return tokens(title).sort().join(' ');
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** True when two titles are the same track (different upload/lyric channel). */
export function isSameSong(a = '', b = '') {
  const ka = tokens(a);
  const kb = tokens(b);
  if (!ka.length || !kb.length) return false;
  if (jaccard(ka, kb) >= 0.55) return true;
  const short = ka.length <= kb.length ? ka : kb;
  const long = ka.length <= kb.length ? kb : ka;
  if (short.every((t) => long.includes(t)) && short.length >= 2) return true;
  return false;
}

/** Artist / track guess from a typical "Artist - Title" video title. */
export function artistAndTrack(title = '') {
  const clean = cleanTitle(title);
  const parts = clean.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), track: parts.slice(1).join(' ').trim() };
  }
  const by = clean.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) return { artist: by[2].trim(), track: by[1].trim() };
  return { artist: '', track: clean };
}

/**
 * Remove duplicate uploads of the same song and cap repeats per channel.
 * `seedTitle` (the currently playing video) is always excluded.
 */
export function dedupeTracks(videos, seedTitle = '', limit = 12, perChannel = 2) {
  const out = [];
  const channels = new Map();
  for (const v of videos || []) {
    if (!v || !v.id) continue;
    if (seedTitle && isSameSong(v.title, seedTitle)) continue;
    if (out.some((keep) => isSameSong(keep.title, v.title))) continue;
    const channel = String(v.channel || '').toLowerCase();
    if (channels.get(channel) >= perChannel) continue;
    channels.set(channel, (channels.get(channel) || 0) + 1);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build a varied but stylistically consistent queue for a seed video.
 * Runs several complementary searches in parallel and merges/dedupes them.
 */
export async function buildMix(seed, search, { count = 12, topic = '' } = {}) {
  const title = seed?.title || '';
  const { artist, track } = artistAndTrack(title);
  const queries = [];
  if (artist) queries.push(`${artist} songs`);
  if (artist) queries.push(`songs like ${artist}`);
  if (artist && track) queries.push(`${artist} ${track} live session`);
  if (track) queries.push(`${track} ${artist} remix`);
  if (topic) queries.push(`${topic} music mix`);
  if (!queries.length && title) queries.push(title);

  const settled = await Promise.allSettled(queries.map((q) => search(q)));
  const pool = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const v of (result.value?.videos || [])) pool.push(v);
  }
  return dedupeTracks(pool, title, count);
}
