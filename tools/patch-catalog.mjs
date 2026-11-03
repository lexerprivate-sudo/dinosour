// Copies real durations from the built library into the catalog.
//
//   node tools/patch-catalog.mjs
//
// Reads data/media-report.json (written by tools/finalize.mjs) and fills in
// `duration` for every video whose media file exists. Safe to run repeatedly.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT = path.join(ROOT, 'data', 'media-report.json');
const CATALOG = path.join(ROOT, 'public', 'data', 'catalog.json');

const report = JSON.parse(await readFile(REPORT, 'utf8'));
const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));

const byId = new Map();
for (const entry of report) {
  const id = path.basename(entry.out, path.extname(entry.out));
  if (entry.duration > 0) byId.set(id, entry);
}

let patched = 0;
const missing = [];

for (const video of catalog.videos) {
  const entry = byId.get(video.id);
  if (!entry) {
    missing.push(video.id);
    continue;
  }
  const seconds = Math.round(entry.duration);
  if (video.duration !== seconds) {
    video.duration = seconds;
    patched += 1;
  }
}

await writeFile(CATALOG, JSON.stringify(catalog, null, 2) + '\n');

console.log(`patched ${patched} duration${patched === 1 ? '' : 's'}`);
if (missing.length) console.log(`no media yet: ${missing.join(', ')}`);

const total = catalog.videos.reduce((n, v) => n + v.duration, 0);
console.log(`library runtime: ${Math.floor(total / 60)}m ${total % 60}s across ${catalog.videos.length} videos`);
