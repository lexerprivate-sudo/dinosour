// Downloads the seed library.
//   - NASA public domain videos (images-api.nasa.gov)
//   - Pexels free-license stock clips (license: free to use)
//   - Blender Foundation open movies (CC-BY, already fetched separately)
// Everything lands in ./raw and a manifest is written to ./data/sources.json

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'raw');
await mkdir(RAW, { recursive: true });

const NASA_QUERIES = [
  { q: 'Earth Views from the International Space Station', want: /Earth Views from the International Space Station/i },
  { q: 'Artemis I Launches to the Moon Official NASA Recap', want: /Artemis I Launches to the Moon/i },
  { q: 'James Webb Space Telescope An Overview', want: /James Webb Space Telescope: An Overview/i },
  { q: 'The Aurora Named STEVE', want: /Aurora Named STEVE/i },
  { q: 'Meanwhile At the Bottom of the Ocean', want: /Bottom of the Ocean/i },
  { q: 'Mars Chopper Ready for a Spin', want: /Chopper Ready for a Spin/i },
  { q: 'How Can I See the Northern Lights', want: /How Can I See the Northern Lights/i },
];

const PEXELS = [
  // travel / city
  8064305, 8064149, 18293320, 1654216, 30989234,
  // food
  34720127, 7204579, 4252336, 4546855,
  // music
  13082773, 26744501, 13427039,
  // tech
  5495845, 31155915, 11274341,
  // nature
  3195394,
];

const manifestFile = path.join(ROOT, 'data', 'sources.json');
let manifest = { nasa: [], pexels: [], blender: [] };
try {
  manifest = JSON.parse(await readFileSafe(manifestFile));
} catch {}

async function readFileSafe(p) {
  const { readFile } = await import('node:fs/promises');
  return readFile(p, 'utf8');
}

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 50_000;
  } catch {
    return false;
  }
}

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    return { ok: r.ok, size: Number(r.headers.get('content-length') || 0) };
  } catch {
    return { ok: false, size: 0 };
  }
}

async function download(url, dest, attempts = 3) {
  if (await exists(dest)) return true;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15 * 60 * 1000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      const s = await stat(dest);
      if (s.size < 50_000) throw new Error('file too small');
      console.log(`  ok ${path.basename(dest)} ${(s.size / 1048576).toFixed(1)} MB`);
      return true;
    } catch (err) {
      console.log(`  retry ${i}/${attempts} ${path.basename(dest)}: ${err.message}`);
      if (i === attempts) return false;
    }
  }
  return false;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function doNasa() {
  console.log('\n== NASA ==');
  for (const entry of NASA_QUERIES) {
    try {
      const search = await fetchJson(
        `https://images-api.nasa.gov/search?q=${encodeURIComponent(entry.q)}&media_type=video&page_size=10`
      );
      const items = search?.collection?.items ?? [];
      const item = items.find((i) => entry.want.test(i.data?.[0]?.title || '')) || items[0];
      if (!item) { console.log(`  miss ${entry.q}`); continue; }
      const d = item.data[0];
      const col = await fetchJson(item.href);
      const files = col.filter((f) => /\.mp4$/i.test(f));
      const pick = (tag) => files.find((f) => f.includes(`~${tag}.mp4`));
      let url = pick('medium') || pick('small') || pick('mobile') || pick('preview') || files[0];
      // Prefer a smaller rendition for very long videos
      const medium = pick('medium');
      const small = pick('small');
      if (medium) {
        const h = await head(medium);
        if (h.size > 90 * 1048576 && small) url = small;
      }
      const file = path.join(RAW, `nasa-${d.nasa_id.replace(/[^a-z0-9_-]/gi, '_')}.mp4`);
      console.log(`• ${d.title}`);
      const ok = await download(url, file);
      if (ok) {
        manifest.nasa = manifest.nasa.filter((x) => x.id !== d.nasa_id);
        manifest.nasa.push({
          id: d.nasa_id,
          title: d.title,
          description: d.description,
          date: d.date_created,
          file: path.relative(ROOT, file).replaceAll('\\', '/'),
          source: url,
        });
      }
    } catch (err) {
      console.log(`  fail ${entry.q}: ${err.message}`);
    }
  }
}

async function doPexels() {
  console.log('\n== Pexels ==');
  for (const id of PEXELS) {
    const file = path.join(RAW, `pexels-${id}.mp4`);
    console.log(`• pexels ${id}`);
    const ok = await download(`https://www.pexels.com/download/video/${id}/`, file);
    if (ok) {
      manifest.pexels = manifest.pexels.filter((x) => x.id !== id);
      manifest.pexels.push({ id, file: path.relative(ROOT, file).replaceAll('\\', '/') });
    }
  }
}

await doNasa();
await doPexels();

await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
console.log('\nmanifest written:', manifestFile);
