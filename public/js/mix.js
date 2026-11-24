/* Smart related / mix track selection.
 *
 * The old implementation searched "<artist> songs" and friends, which makes
 * YouTube return that same artist from a dozen lyric channels. This module
 * instead derives the VIBE (genre / mood / topic) from the user's search and
 * the seed video's own metadata, searches artist-neutral queries, and removes
 * anything performed by the seed artist. The result is a mix of *different
 * artists and playlists* that share the same musical style.
 */

import { videoInfo } from './yt.js';

const NOISE = /\b(lyrics?|lyric|official|video|audio|music|slowed|reverb|sped|up|nightcore|remix|cover|karaoke|visualizer|visualiser|live|acoustic|full|album|hd|hq|4k|1080p|720p|cc|sub|español|english|version|by|the|from|with|feat|ft)\b/gi;

/* Genre words we use to steer searches away from a single performer. */
const GENRE_WORDS = [
  'pop', 'rock', 'indie', 'alternative', 'country', 'hip hop', 'rap', 'r&b',
  'soul', 'jazz', 'classical', 'electronic', 'edm', 'dance', 'folk', 'metal',
  'punk', 'latin', 'reggaeton', 'k-pop', 'lofi', 'lo-fi', 'blues', 'gospel',
  'funk', 'disco', 'techno', 'house', 'ambient', 'soundtrack',
];

/* Lightweight hints for well-known artists: YouTube keywords frequently list
 * only the artist and song, with no genre, so these keep the mix in style. */
const ARTIST_GENRES = {
  taylorswift: 'pop country', billieeilish: 'pop alternative', oliviarodrigo: 'pop',
  duaipa: 'pop dance', theweeknd: 'pop r&b', arianagrande: 'pop', justinbieber: 'pop',
  edsheeran: 'pop acoustic', brunomars: 'pop r&b', ladygaga: 'pop dance',
  katyperry: 'pop', rihanna: 'pop r&b', beyonce: 'r&b pop', shakira: 'latin pop',
  drake: 'hip hop rap', kendricklamar: 'hip hop rap', travisscott: 'hip hop rap',
  lilwayne: 'hip hop rap', eminem: 'hip hop rap', snoopdogg: 'hip hop rap',
  postmalone: 'hip hop pop', morganwallen: 'country', lukecombs: 'country',
  zacbryan: 'country', carrieunderwood: 'country', keithurban: 'country',
  bonjovi: 'rock', queen: 'rock', nirvana: 'rock', metallica: 'metal rock',
  acdc: 'rock', linkingpark: 'rock', coldplay: 'rock pop', radiohead: 'indie rock',
  thebeatles: 'rock', elvispresley: 'rock', michaeljackson: 'pop soul',
};

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

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(vevo|official|lyrics?|music|channel|records)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function artistTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'of'].includes(w));
}

function hasArtistToken(text, tokens) {
  const hay = normName(text);
  return tokens.some((t) => t.length > 2 && hay.includes(t));
}

function hasGenre(text) {
  const hay = ` ${String(text || '').toLowerCase()} `;
  return GENRE_WORDS.some((g) => hay.includes(` ${g} `));
}

/** Performing artist identity for a video, used to keep the seed artist out. */
export function artistOf(video) {
  return normName(artistAndTrack(video?.title || '').artist || video?.channel || '');
}

/**
 * True when a candidate is performed by the seed artist. Also catches the
 * common "Track - Artist" upload format and "Track (Artist Lyrics)" titles,
 * while still keeping covers *by other artists* (whose titles mention the
 * original artist in parentheses).
 */
export function isSameArtist(video, seed) {
  const names = [artistAndTrack(seed?.title || '').artist, seed?.channel]
    .filter(Boolean)
    .map(normName)
    .filter((n) => n.length > 2);
  if (!names.length) return false;

  const title = String(video?.title || '');
  const channel = String(video?.channel || '');
  const parts = title.split(/\s+[-–—]\s+/);
  const sides = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [channel];

  const matches = (value) => {
    const n = normName(value);
    return names.some(
      (name) =>
        n === name ||
        (name.length > 3 && n.includes(name)) ||
        (n.length > 3 && name.includes(n))
    );
  };

  // "Artist - Track" or "Track - Artist": check both ends. A trailing mention
  // of the seed artist is ignored when the title says it is a cover/tribute.
  for (let i = 0; i < sides.length; i++) {
    if (i === 1 && /\b(cover|tribute|remix|karaoke|version)\b/i.test(parts[parts.length - 1])) continue;
    if (matches(sides[i])) return true;
  }
  // "Taylor Swift being the MAIN CHARACTER..." has no dash but starts with
  // the artist name — it is about the artist, not a different performer.
  if (parts.length === 1 && names.some((name) => normName(title).startsWith(name))) return true;
  return false;
}

/**
 * Remove duplicate uploads of the same song, cap repeats per performing
 * artist, and (when a seed is given) keep the seed artist out entirely.
 */
export function dedupeTracks(videos, seedTitle = '', limit = 12, perArtist = 2, seed = null) {
  const out = [];
  const artists = new Map();
  const channels = new Map();
  const channelLimit = Math.max(3, perArtist * 3);
  for (const v of videos || []) {
    if (!v || !v.id) continue;
    if (seedTitle && isSameSong(v.title, seedTitle)) continue;
    if (seed && isSameArtist(v, seed)) continue;
    if (out.some((keep) => isSameSong(keep.title, v.title))) continue;
    const artist = artistOf(v);
    if (artist && (artists.get(artist) || 0) >= perArtist) continue;
    const channel = normName(v.channel || '');
    if (channels.get(channel) >= channelLimit) continue;
    if (artist) artists.set(artist, (artists.get(artist) || 0) + 1);
    channels.set(channel, (channels.get(channel) || 0) + 1);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/** Remove the artist's own words from a search phrase, keeping the vibe. */
export function withoutArtist(text, artist, channel = '') {
  let out = String(text || '');
  for (const name of [artist, channel].filter(Boolean)) {
    for (const token of name.split(/\s+/).filter((w) => w.length > 2)) {
      out = out.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), ' ');
    }
  }
  return out
    .replace(/\b(songs?|music|video|official|lyrics?|audio|mix|playlist|the|a)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferGenres(text) {
  const hay = ` ${String(text || '').toLowerCase()} `;
  return GENRE_WORDS.filter((g) => hay.includes(` ${g} `));
}

/**
 * Build a mix around the VIBE/TOPIC the user searched, not the seed artist.
 * Genre/mood terms come from the search query, the seed's own keywords and a
 * small hint table; every query is artist-neutral and the seed artist is
 * filtered from the results.
 */
export async function buildMix(seed, search, { count = 12, topic = '' } = {}) {
  const title = seed?.title || '';
  const { artist, track } = artistAndTrack(title);
  const seedTokens = artistTokens(artist || seed?.channel || '');

  const info = await videoInfo(seed?.id).catch(() => null);
  const keywords = (info?.keywords || []).map((k) => String(k).trim());
  const hint = ARTIST_GENRES[normName(artist)] || ARTIST_GENRES[normName(seed?.channel || '')] || '';
  const text = `${hint} ${topic} ${title} ${keywords.join(' ')} ${(info?.description || '').slice(0, 500)}`;
  const genres = [...new Set(inferGenres(text))].slice(0, 4);

  const vibe = withoutArtist(topic, artist, seed?.channel);
  const vibeTerms = vibe
    .split(/\s+/)
    .filter((w) => w.length > 2 && !hasGenre(w))
    .slice(0, 3);

  const cleanKeywords = keywords
    .filter((k) => k.length > 2 && !hasArtistToken(k, seedTokens) && !hasGenre(k))
    .slice(0, 4);

  const queries = [];
  const add = (value) => {
    const q = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (q && !queries.includes(q)) queries.push(q);
  };

  for (const g of genres.slice(0, 3)) {
    add(`${g} songs playlist`);
    add(`best ${g} playlist`);
  }
  if (genres.length >= 2) add(`${genres[0]} ${genres[1]} mix playlist`);
  for (const term of vibeTerms) {
    add(`${term} playlist`);
    add(`${term} mix`);
  }
  for (const keyword of cleanKeywords.slice(0, 2)) add(`${keyword} playlist`);
  if (track) {
    add(`${track} cover`);
    add(`songs like ${track}`);
  }
  if (!queries.length) {
    add(`${track || cleanTitle(title)} playlist`);
    add('pop songs playlist');
  }

  const settled = await Promise.allSettled(queries.map((q) => search(q)));
  const pool = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const v of (result.value?.videos || [])) pool.push(v);
  }
  return dedupeTracks(pool, title, count, 1, seed);
}
