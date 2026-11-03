#!/usr/bin/env node
/**
 * dinosour — tiny local video server.
 * Serves the app, the video files (with HTTP range support for seeking),
 * generated thumbnails, and the live YouTube search API. No dependencies.
 */
import http from 'node:http';
import os from 'node:os';
import dgram from 'node:dgram';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { searchAll, suggestYouTube, videoInfo } from './functions/_lib/youtube.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// DINOSOUR_PREVIEW=dist serves the packed deployment locally.
const PREVIEW =
  process.env.DINOSOUR_PREVIEW === 'dist' ||
  process.env.WATCH_PREVIEW === 'dist' ||
  process.env.TOT_PREVIEW === 'dist';
const PUBLIC = PREVIEW ? path.join(ROOT, 'dist') : path.join(ROOT, 'public');
const MEDIA = PREVIEW ? path.join(ROOT, 'dist', 'media') : path.join(ROOT, 'media');
const THUMBS = PREVIEW ? path.join(ROOT, 'dist', 'thumbs') : path.join(ROOT, 'thumbs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.ts']);

function safeJoin(base, requestPath) {
  const joined = path.normalize(path.join(base, requestPath));
  if (!joined.startsWith(base + path.sep) && joined !== base) return null;
  return joined;
}

async function statFile(file) {
  try {
    const s = await fs.stat(file);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    // suffix range: last N bytes
    const len = Math.min(end, size);
    start = size - len;
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1), size };
}

function sendFile(req, res, file, stat, { cache, rangeOk }) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }

  const range = rangeOk ? parseRange(req.headers.range, stat.size) : null;
  if (range?.invalid) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
    res.end();
    return;
  }

  const baseHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache || 'no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };

  if (range) {
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${range.size}`,
      'Content-Length': range.end - range.start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const apiCache = new Map();
const API_TTL = { search: 120_000, suggest: 3_600_000, video: 21_600_000 };

function cacheGet(key) {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    apiCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttl) {
  if (apiCache.size > 300) apiCache.delete(apiCache.keys().next().value);
  apiCache.set(key, { value, expires: Date.now() + ttl });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  const param = (name) => (url.searchParams.get(name) || '').trim();

  try {
    if (pathname === '/api/search') {
      const q = param('q').slice(0, 200);
      const continuation = param('continuation');
      if (!q && !continuation) return sendJson(res, 400, { ok: false, error: 'Missing search query.' });

      const key = `search:${q}:${continuation}`;
      const cached = cacheGet(key);
      if (cached) return sendJson(res, 200, cached);

      const result = await searchAll(q, { continuation });
      if (!result) {
        return sendJson(res, 502, { ok: false, error: 'Live YouTube search is unavailable right now.' });
      }
      cacheSet(key, result, API_TTL.search);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/suggest') {
      const q = param('q').slice(0, 200);
      if (!q) return sendJson(res, 200, { suggestions: [] });

      const key = `suggest:${q.toLowerCase()}`;
      const cached = cacheGet(key);
      if (cached) return sendJson(res, 200, cached);

      const suggestions = await suggestYouTube(q).catch(() => []);
      const body = { suggestions };
      cacheSet(key, body, API_TTL.suggest);
      return sendJson(res, 200, body);
    }

    if (pathname === '/api/video') {
      const id = param('id');
      if (!/^[\w-]{11}$/.test(id)) return sendJson(res, 400, { ok: false, error: 'Bad video id.' });

      const key = `video:${id}`;
      const cached = cacheGet(key);
      if (cached) return sendJson(res, 200, cached);

      const info = await videoInfo(id);
      if (!info) return sendJson(res, 404, { ok: false, error: 'Video not found.' });
      cacheSet(key, info, API_TTL.video);
      return sendJson(res, 200, info);
    }

    return sendJson(res, 404, { ok: false, error: 'Unknown API route.' });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: err?.message ? String(err.message).slice(0, 160) : 'Upstream request failed.',
    });
  }
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // live YouTube search / metadata (same routes as the Pages Functions)
  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname);
  }

  // media
  if (pathname.startsWith('/media/')) {
    const rel = pathname.slice('/media'.length);
    const file = path.normalize(path.join(MEDIA, rel));
    if (!file.startsWith(MEDIA + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const stat = await statFile(file);
    if (!stat) {
      res.writeHead(404);
      return res.end('Not found');
    }
    return sendFile(req, res, file, stat, {
      cache: 'public, max-age=604800',
      rangeOk: VIDEO_EXT.has(path.extname(file).toLowerCase()),
    });
  }

  // thumbnails
  if (pathname.startsWith('/thumbs/')) {
    const rel = pathname.slice('/thumbs'.length);
    const file = path.normalize(path.join(THUMBS, rel));
    if (!file.startsWith(THUMBS + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const stat = await statFile(file);
    if (!stat) {
      res.writeHead(404);
      return res.end('Not found');
    }
    return sendFile(req, res, file, stat, { cache: 'public, max-age=86400' });
  }

  // static app files
  const file = safeJoin(PUBLIC, pathname);
  if (file) {
    const stat = await statFile(file);
    if (stat) {
      const isAsset = /^\/(css|js|data)\//.test(pathname);
      return sendFile(req, res, file, stat, {
        cache: isAsset ? 'no-cache' : 'no-cache',
        rangeOk: false,
      });
    }
  }

  // SPA fallback for page routes
  if (req.headers.accept?.includes('text/html') || pathname === '/') {
    const index = await statFile(path.join(PUBLIC, 'index.html'));
    if (index) return sendFile(req, res, path.join(PUBLIC, 'index.html'), index, { cache: 'no-cache', rangeOk: false });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

const PORT = Number(process.env.PORT) || 3000;
const OPEN = process.argv.includes('--open') || process.env.OPEN === '1';

const server = http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error('request error:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  });
});

let attempts = 0;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

// Lets the Android app find this machine on the local network without typing an IP.
let discovery = null;
function startDiscovery(port) {
  if (discovery) return;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discovery = socket;
  socket.on('error', (err) => {
    console.error(`  discovery unavailable: ${err.message}`);
    try { socket.close(); } catch {}
    discovery = null;
  });
  socket.on('message', (msg, rinfo) => {
    if (msg.toString().trim() !== 'DINOSOUR_DISCOVER_V1') return;
    const reply = Buffer.from(JSON.stringify({ app: 'dinosour', port, host: os.hostname() }));
    socket.send(reply, rinfo.port, rinfo.address, () => {});
  });
  socket.bind(41234, () => {
    try { socket.setBroadcast(true); } catch {}
  });
}

function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts < 10) {
      attempts += 1;
      console.log(`port ${port} is busy, trying ${port + 1}…`);
      listen(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  dinosour is running →  ${url}\n`);
    console.log(`  serving ${path.relative(process.cwd(), PUBLIC) || PUBLIC}`);
    const lan = lanAddresses();
    if (lan.length) {
      console.log(`  phone  →  ${lan.map((ip) => `http://${ip}:${port}`).join('  ')}`);
      console.log('  same Wi-Fi, then the Android app finds it automatically');
    }
    console.log('  press Ctrl+C to stop\n');
    startDiscovery(port);
    if (OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

listen(PORT);
