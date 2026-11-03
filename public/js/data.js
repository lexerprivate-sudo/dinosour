/* Catalog loading and lookups. */

import { compact } from './util.js';

let data = null;
const videoIndex = new Map();
const channelIndex = new Map();

export async function loadCatalog() {
  const res = await fetch('/data/catalog.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load catalog (${res.status})`);
  data = await res.json();
  videoIndex.clear();
  channelIndex.clear();
  for (const c of data.channels) channelIndex.set(c.id, c);
  for (const v of data.videos) {
    v.channelData = channelIndex.get(v.channel) || { id: v.channel, name: v.channel, color: '#555' };
    videoIndex.set(v.id, v);
  }
  for (const c of data.channels) {
    const vids = data.videos.filter((v) => v.channel === c.id);
    c.videoCount = vids.length;
    c.totalViews = vids.reduce((n, v) => n + (v.views || 0), 0);
  }
  return data;
}

export const catalog = () => data;

export const channelById = (id) =>
  channelIndex.get(id) || { id, name: 'Unknown channel', color: '#555', videos: 0, totalViews: 0 };

export const videoById = (id) => videoIndex.get(id) || null;

export const allVideos = () => (data ? data.videos : []);

export const longVideos = () => (data ? data.videos.filter((v) => !v.short) : []);

export const shortVideos = () => (data ? data.videos.filter((v) => v.short) : []);

export const channelVideos = (channelId) =>
  allVideos()
    .filter((v) => v.channel === channelId)
    .sort((a, b) => new Date(b.published) - new Date(a.published));

export const categories = () => (data ? data.categories : []);

export function relatedFor(video, limit = 12) {
  const pool = longVideos().filter((v) => v.id !== video.id);
  const score = (v) => {
    let s = 0;
    if (v.category === video.category) s += 4;
    if (v.channel === video.channel) s += 2;
    for (const t of v.tags || []) {
      if ((video.tags || []).includes(t)) s += 1;
    }
    return s;
  };
  return pool
    .map((v) => ({ v, s: score(v) }))
    .sort((a, b) => b.s - a.s || (b.v.views || 0) - (a.v.views || 0))
    .slice(0, limit)
    .map((x) => x.v);
}

export function searchVideos(query, limit = 40) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return allVideos()
    .map((v) => {
      const title = v.title.toLowerCase();
      const channel = v.channelData.name.toLowerCase();
      const tags = (v.tags || []).join(' ').toLowerCase();
      const desc = (v.description || '').toLowerCase();
      let score = 0;
      if (title.includes(q)) score += 12;
      if (channel.includes(q)) score += 6;
      if (tags.includes(q)) score += 5;
      if (desc.includes(q)) score += 2;
      for (const w of words) {
        if (title.includes(w)) score += 3;
        if (tags.includes(w)) score += 2;
        if (channel.includes(w)) score += 1;
        if (desc.includes(w)) score += 1;
      }
      return { v, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.v.views || 0) - (a.v.views || 0))
    .slice(0, limit)
    .map((x) => x.v);
}

export function searchChannels(query, limit = 3) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (data ? data.channels : [])
    .filter((c) => c.name.toLowerCase().includes(q) || (c.handle || '').toLowerCase().includes(q))
    .slice(0, limit);
}

export const commentsFor = (videoId) => (data && data.comments ? data.comments[videoId] || [] : []);

export const formatViews = compact;
