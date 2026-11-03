// Transcodes the raw library to web-friendly 720p MP4s, generates thumbnails,
// and reports durations. Run after tools/download.mjs. Requires ffmpeg on PATH.
//
//   node tools/finalize.mjs [--force]

import { execFileSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'raw');
const MEDIA = path.join(ROOT, 'media');
const THUMBS = path.join(ROOT, 'thumbs');
const FORCE = process.argv.includes('--force');

const RULES = [
  // Blender open movies (CC-BY)
  { match: /(^|[/\\])bbb\.mp4$/i, out: 'big-buck-bunny.mp4', thumbAt: 0.3 },
  { match: /(^|[/\\])sintel\.mp4$/i, out: 'sintel.mp4', thumbAt: 0.28 },
  { match: /(^|[/\\])tos\.mp4$/i, out: 'tears-of-steel.mp4', thumbAt: 0.35, reencode: true },
  { match: /(^|[/\\])ed\.mp4$/i, out: 'elephants-dream.mp4', thumbAt: 0.4, reencode: true },

  // NASA public domain
  { match: /nasa-.*Earth_Views/i, out: 'earth-from-space.mp4', thumbAt: 0.25 },
  { match: /nasa-.*Artemis/i, out: 'artemis-launch.mp4', thumbAt: 0.2 },
  { match: /nasa-.*Webb/i, out: 'webb-overview.mp4', thumbAt: 0.3 },
  { match: /nasa-.*Steve/i, out: 'aurora-steve.mp4', thumbAt: 0.35 },
  { match: /nasa-.*Bottom_Ocean/i, out: 'bottom-of-the-ocean.mp4', thumbAt: 0.3 },
  { match: /nasa-.*Chopper/i, out: 'mars-chopper.mp4', thumbAt: 0.25 },
  { match: /nasa-.*Northern_Lights/i, out: 'northern-lights.mp4', thumbAt: 0.3 },
  { match: /nasa-NISAR/i, out: 'nisar.mp4', thumbAt: 0.3 },

  // Pexels free-license clips
  { match: /pexels-8064305/i, out: 'city-lights.mp4', thumbAt: 0.4 },
  { match: /pexels-8064149/i, out: 'sunset-skyline.mp4', thumbAt: 0.4 },
  { match: /pexels-18293320/i, out: 'kuala-lumpur.mp4', thumbAt: 0.4 },
  { match: /pexels-1654216/i, out: 'city-timelapse.mp4', thumbAt: 0.4 },
  { match: /pexels-30989234/i, out: 'night-highway.mp4', thumbAt: 0.4 },
  { match: /pexels-3195394/i, out: 'coastline.mp4', thumbAt: 0.4 },
  { match: /pexels-34720127/i, out: 'flambe.mp4', thumbAt: 0.45 },
  { match: /pexels-7204579/i, out: 'home-kitchen.mp4', thumbAt: 0.45 },
  { match: /pexels-4252336/i, out: 'chefs-pan.mp4', thumbAt: 0.45 },
  { match: /pexels-4546855/i, out: 'plated.mp4', thumbAt: 0.45 },
  { match: /pexels-13082773/i, out: 'concert-crowd.mp4', thumbAt: 0.4 },
  { match: /pexels-26744501/i, out: 'hands-up.mp4', thumbAt: 0.4 },
  { match: /pexels-13427039/i, out: 'live-band.mp4', thumbAt: 0.4 },
  { match: /pexels-5495845/i, out: 'late-night-code.mp4', thumbAt: 0.4 },
  { match: /pexels-31155915/i, out: 'shipping-code.mp4', thumbAt: 0.4 },
  { match: /pexels-11274341/i, out: 'javascript.mp4', thumbAt: 0.4 },
];

function run(bin, args, opts = {}) {
  return execFileSync(bin, args, { maxBuffer: 32 * 1024 * 1024, ...opts });
}

function probe(file) {
  const out = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,codec_name,avg_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(out.toString());
  const s = j.streams?.[0] || {};
  const [num, den] = String(s.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    codec: s.codec_name || '',
    fps: den ? num / den : 0,
    duration: Number(j.format?.duration) || 0,
  };
}

function transcode(src, dest, meta, force = false) {
  const needs = force || meta.height > 720 || meta.width > 1280 || meta.codec !== 'h264';
  if (!needs) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-map', '0', '-c', 'copy', '-movflags', '+faststart', dest]);
  } else {
    run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', src,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-maxrate', '2M', '-bufsize', '4M',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      dest,
    ]);
  }
}

function thumbnail(video, dest, meta, at, vertical) {
  const t = Math.max(0.5, Math.min(meta.duration * (at ?? 0.35), Math.max(1, meta.duration - 1), 30));
  const isVertical = vertical || meta.height > meta.width;
  const filter = isVertical
    ? 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960'
    : 'scale=960:540:force_original_aspect_ratio=increase,crop=960:540';
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', t.toFixed(2),
    '-i', video,
    '-frames:v', '1',
    '-vf', `${filter},eq=saturation=1.04:contrast=1.02`,
    '-q:v', '4',
    dest,
  ]);
}

async function main() {
  await fs.mkdir(MEDIA, { recursive: true });
  await fs.mkdir(THUMBS, { recursive: true });

  // Shorts get a 9:16 thumbnail so the rail stays sharp.
  const shortIds = new Set();
  try {
    const cat = JSON.parse(await fs.readFile(path.join(ROOT, 'public', 'data', 'catalog.json'), 'utf8'));
    for (const v of cat.videos || []) if (v.short) shortIds.add(v.id);
  } catch { /* catalog optional */ }

  const rawFiles = (await fs.readdir(RAW).catch(() => [])).filter((f) => /\.(mp4|m4v|webm)$/i.test(f));
  const report = [];
  const unmatched = [];

  for (const file of rawFiles) {
    const full = path.join(RAW, file);
    const rule = RULES.find((r) => r.match.test(full));
    if (!rule) {
      unmatched.push(file);
      continue;
    }
    const out = path.join(MEDIA, rule.out);
    const thumb = path.join(THUMBS, rule.out.replace(/\.mp4$/i, '.jpg'));
    if (!FORCE && existsSync(out) && existsSync(thumb)) {
      report.push({ out: rule.out, ...probe(out), skipped: true });
      console.log(`· skip ${rule.out} (already built)`);
      continue;
    }
    try {
      const meta = probe(full);
      console.log(`→ ${file} (${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s)`);
      transcode(full, out, meta, rule.reencode);
      const final = probe(out);
      thumbnail(out, thumb, final, rule.thumbAt, shortIds.has(path.basename(rule.out, '.mp4')));
      report.push({ out: rule.out, src: file, ...final });
      console.log(`   ✓ media/${rule.out}  thumbs/${path.basename(thumb)}`);
    } catch (err) {
      console.error(`   ✗ failed: ${err.message.split('\n')[0]}`);
    }
  }

  if (unmatched.length) console.log(`\nUnmatched raw files (not in RULES):\n  ${unmatched.join('\n  ')}`);

  report.sort((a, b) => (a.out < b.out ? -1 : 1));
  await fs.writeFile(path.join(ROOT, 'data', 'media-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.length} videos ready. Report written to data/media-report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
