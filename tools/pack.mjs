// Assembles a deployable static site in dist/.
//
//   node tools/pack.mjs                    # app + MP4 + thumbs (self-contained)
//   node tools/pack.mjs --hls              # app + HLS + thumbs (Cloudflare Pages)
//   node tools/pack.mjs --media-base <url> # app + thumbs only, video on a CDN
//
// `--hls` and `--media-base` rewrite the catalog src **only in the output copy**.
// The source catalog is never modified, so `npm start` keeps using the MP4s.

import { cp, mkdir, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const HLS = args.includes('--hls');

let mediaBase = '';
const inline = args.find((a) => a.startsWith('--media-base='));
if (inline) {
  mediaBase = inline.slice('--media-base='.length);
} else {
  const i = args.indexOf('--media-base');
  if (i !== -1) mediaBase = args[i + 1] || '';
}
mediaBase = mediaBase.replace(/\/+$/, '');

const wantsMediaBase = args.some((a) => a === '--media-base' || a.startsWith('--media-base='));
if (wantsMediaBase && !mediaBase) {
  console.error('✗ --media-base needs a URL, e.g. --media-base=https://cdn.example.com/media');
  process.exit(1);
}
if (HLS && mediaBase) {
  console.error('✗ choose either --hls or --media-base, not both');
  process.exit(1);
}

const catalogPath = path.join(ROOT, 'public', 'data', 'catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

const missing = [];
for (const video of catalog.videos) {
  if (HLS) {
    if (!existsSync(path.join(ROOT, 'media', 'hls', video.id, 'index.m3u8'))) {
      missing.push(`media/hls/${video.id}/index.m3u8`);
    }
  } else {
    const rel = video.src.replace(/^\//, '');
    if (!existsSync(path.join(ROOT, rel))) missing.push(rel);
  }
  const thumb = video.thumb.replace(/^\//, '');
  if (!existsSync(path.join(ROOT, thumb))) missing.push(thumb);
}

if (missing.length) {
  console.error(
    `\n✗ ${missing.length} file(s) missing — build the library first${
      HLS ? ' (`npm run hls`)' : ''
    }:\n  ${missing.join('\n  ')}`
  );
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp(path.join(ROOT, 'public'), OUT, { recursive: true });
await cp(path.join(ROOT, 'thumbs'), path.join(OUT, 'thumbs'), { recursive: true });

if (HLS) {
  await cp(path.join(ROOT, 'media', 'hls'), path.join(OUT, 'media', 'hls'), { recursive: true });
  const outCatalog = structuredClone(catalog);
  for (const video of outCatalog.videos) {
    video.src = `/media/hls/${video.id}/index.m3u8`;
  }
  await writeFile(path.join(OUT, 'data', 'catalog.json'), JSON.stringify(outCatalog, null, 2) + '\n');
} else if (mediaBase) {
  const outCatalog = structuredClone(catalog);
  for (const video of outCatalog.videos) {
    if (video.src.startsWith('/media/')) {
      video.src = `${mediaBase}/${path.basename(video.src)}`;
    }
  }
  await writeFile(path.join(OUT, 'data', 'catalog.json'), JSON.stringify(outCatalog, null, 2) + '\n');
} else {
  await cp(path.join(ROOT, 'media'), path.join(OUT, 'media'), {
    recursive: true,
    filter: (src) => src !== path.join(ROOT, 'media', 'hls'),
  });
}

// A copy of the credits so the deployed site keeps the license text with it.
const readme = path.join(ROOT, 'README.md');
if (existsSync(readme)) await cp(readme, path.join(OUT, 'README.md'));

async function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  let largest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = await dirStats(full);
      bytes += s.bytes;
      files += s.files;
      largest = Math.max(largest, s.largest);
    } else {
      const size = (await stat(full)).size;
      bytes += size;
      files += 1;
      largest = Math.max(largest, size);
    }
  }
  return { bytes, files, largest };
}

const stats = await dirStats(OUT);
const mode = HLS ? 'HLS' : mediaBase ? `video at ${mediaBase}` : 'self-contained';
console.log(
  `✓ dist/ ready — ${(stats.bytes / 1048576).toFixed(1)} MB, ${stats.files} files ` +
    `(${mode}, largest ${(stats.largest / 1048576).toFixed(2)} MB)`
);

if (HLS) {
  if (stats.largest > 25 * 1024 * 1024) {
    console.log('\n  ✗ a file is over 25 MiB — Cloudflare Pages will reject it.');
  }
  if (stats.files > 20000) {
    console.log('\n  ✗ over 20,000 files — Cloudflare Pages will reject the deploy.');
  }
} else if (!mediaBase) {
  const big = [];
  if (existsSync(path.join(OUT, 'media'))) {
    for (const f of await readdir(path.join(OUT, 'media'))) {
      if (!f.endsWith('.mp4')) continue;
      const s = (await stat(path.join(OUT, 'media', f))).size;
      if (s > 25 * 1024 * 1024) big.push(`${f} (${(s / 1048576).toFixed(1)} MB)`);
    }
  }
  if (big.length) {
    console.log('\n  files over 25 MB (Cloudflare Pages rejects these — use --hls or --media-base):');
    for (const b of big) console.log(`    ${b}`);
  }
}
