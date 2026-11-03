// Turns media/<id>.mp4 into an HLS folder that a static host can serve:
//
//   media/hls/<id>/index.m3u8
//   media/hls/<id>/seg000.ts …
//
// Cloudflare Pages rejects files over 25 MiB, but HLS segments are a few MB,
// so the entire library fits on Pages' free unlimited-bandwidth plan. The copy
// is lossless (`-c copy`), so this takes seconds per film.
//
//   node tools/hls.mjs [--force] [--only=id,id]

import { execFileSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MEDIA = path.join(ROOT, 'media');
const HLS = path.join(MEDIA, 'hls');
const FORCE = process.argv.includes('--force');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.split('=')[1].split(',')) : null;

const catalog = JSON.parse(
  await fs.readFile(path.join(ROOT, 'public', 'data', 'catalog.json'), 'utf8')
);

async function newestMtime(dir) {
  let newest = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    newest = Math.max(newest, (await fs.stat(path.join(dir, entry.name))).mtimeMs);
  }
  return newest;
}

let built = 0;
let skipped = 0;
let maxSegment = 0;
let totalBytes = 0;

for (const video of catalog.videos) {
  if (only && !only.has(video.id)) continue;

  const src = path.join(ROOT, video.src.replace(/^\//, ''));
  const outDir = path.join(HLS, video.id);
  const playlist = path.join(outDir, 'index.m3u8');

  if (!existsSync(src)) {
    console.error(`✗ missing ${path.relative(ROOT, src)}`);
    process.exitCode = 1;
    continue;
  }

  if (!FORCE && existsSync(playlist)) {
    const srcTime = (await fs.stat(src)).mtimeMs;
    const hlsTime = await newestMtime(outDir);
    if (hlsTime > srcTime) {
      skipped += 1;
      console.log(`· ${video.id} (up to date)`);
      continue;
    }
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  console.log(`→ ${video.id}`);
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-i', src,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c', 'copy',
      '-start_number', '0',
      '-hls_time', '6',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(outDir, 'seg%03d.ts'),
      playlist,
    ],
    { maxBuffer: 16 * 1024 * 1024 }
  );

  // Sanity check: playlist exists and points at real segments.
  const text = await fs.readFile(playlist, 'utf8');
  const segments = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (!segments.length) throw new Error(`${video.id}: empty HLS playlist`);
  for (const seg of segments) {
    const full = path.join(outDir, seg.trim());
    if (!existsSync(full)) throw new Error(`${video.id}: missing segment ${seg}`);
    maxSegment = Math.max(maxSegment, (await fs.stat(full)).size);
  }

  built += 1;
}

async function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = await dirStats(full);
      bytes += s.bytes;
      files += s.files;
    } else {
      bytes += (await fs.stat(full)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

const stats = existsSync(HLS) ? await dirStats(HLS) : { bytes: 0, files: 0 };
maxSegment = 0;
for (const id of await fs.readdir(HLS).catch(() => [])) {
  for (const f of await fs.readdir(path.join(HLS, id)).catch(() => [])) {
    if (f.endsWith('.ts')) {
      maxSegment = Math.max(maxSegment, (await fs.stat(path.join(HLS, id, f))).size);
    }
  }
}

console.log(
  `\n${built} built, ${skipped} skipped. ` +
    `${stats.files} files, ${(stats.bytes / 1048576).toFixed(0)} MB, ` +
    `largest segment ${(maxSegment / 1048576).toFixed(2)} MB`
);
if (maxSegment > 25 * 1024 * 1024) {
  console.error('✗ a segment is over 25 MiB — lower --hls_time or re-encode that video');
  process.exitCode = 1;
}
