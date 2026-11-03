// One-command deploy: app on Cloudflare Pages, video on Cloudflare R2.
//
//   npm run login          # once, opens the browser
//   npm run cloud          # create bucket + upload video + deploy app
//
// Options:
//   --force        re-upload every video, even unchanged ones
//   --skip-media   only rebuild + deploy the app (video already in R2)
//   --bucket NAME  override the R2 bucket (default: dinosour-media)
//   --project NAME override the Pages project (default: dinosour)
//
// Environment:
//   DINOSOUR_MEDIA_BASE  a custom media origin (e.g. https://media.example.com).
//                        Omit it to use the bucket's free r2.dev URL.

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const MEDIA = path.join(ROOT, 'media');
const STATE = path.join(ROOT, 'data', 'r2-state.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BUCKET = option(
  'bucket',
  process.env.DINOSOUR_BUCKET || process.env.WATCH_BUCKET || process.env.TOT_BUCKET || 'dinosour-media'
);
const PROJECT = option(
  'project',
  process.env.DINOSOUR_PROJECT || process.env.WATCH_PROJECT || process.env.TOT_PROJECT || 'dinosour'
);
const FORCE = flag('force');
const SKIP_MEDIA = flag('skip-media');

function wrangler(args, { quiet = false } = {}) {
  const res = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  return { ok: res.status === 0, status: res.status, out };
}

function fail(message, out = '') {
  console.error(`\n✗ ${message}`);
  if (out.trim()) console.error(out.trim().split('\n').slice(-12).join('\n'));
  process.exit(1);
}

function log(message) {
  console.log(message);
}

/* ---------------------------------------------------------------- auth */
const who = wrangler(['whoami']);
if (/not authenticated/i.test(who.out)) {
  fail(
    'Cloudflare is not connected yet.\n\n  Run this once, approve it in the browser, then run the deploy again:\n\n    npm run login\n'
  );
}
const email = who.out.match(/associated with the email ([^\s,]+)/i)?.[1];
log(`✓ Cloudflare account${email ? `: ${email}` : ''}`);

/* -------------------------------------------------------------- bucket */
const created = wrangler(['r2', 'bucket', 'create', BUCKET]);
if (created.ok) {
  log(`✓ bucket ${BUCKET} created`);
} else if (/already exists|conflict|10004/i.test(created.out)) {
  log(`✓ bucket ${BUCKET}`);
} else {
  fail(`could not create/access bucket "${BUCKET}"`, created.out);
}

/* ---------------------------------------------------------- public URL */
let origin = (
  process.env.DINOSOUR_MEDIA_BASE ||
  process.env.WATCH_MEDIA_BASE ||
  process.env.TOT_MEDIA_BASE ||
  ''
).replace(/\/+$/, '');
if (origin) {
  log(`✓ media origin: ${origin}`);
} else {
  const current = wrangler(['r2', 'bucket', 'dev-url', 'get', BUCKET]);
  let match = current.out.match(/https:\/\/[a-z0-9.-]+\.r2\.dev/i);
  if (!match) {
    const enabled = wrangler(['r2', 'bucket', 'dev-url', 'enable', BUCKET, '--force']);
    match = enabled.out.match(/https:\/\/[a-z0-9.-]+\.r2\.dev/i);
    if (!match) {
      fail(
        'could not enable the public r2.dev URL.\n  Open the R2 bucket → Settings → Public Development URL → Enable, then re-run.',
        enabled.out
      );
    }
  }
  origin = match[0];
  log(`✓ media origin: ${origin}`);
}

/* --------------------------------------------------------------- video */
if (SKIP_MEDIA) {
  log('· skipping upload, using the existing bucket contents');
} else {
  await mkdir(path.dirname(STATE), { recursive: true });
  let state = {};
  try {
    state = JSON.parse(await readFile(STATE, 'utf8'));
  } catch { /* first deploy */ }

  const files = (await readdir(MEDIA)).filter((f) => f.endsWith('.mp4')).sort();
  if (!files.length) fail('media/ is empty — run `npm run build` first');

  const totalBytes = (await Promise.all(files.map((f) => stat(path.join(MEDIA, f))))).reduce(
    (n, s) => n + s.size,
    0
  );
  let uploadedBytes = 0;
  let skipped = 0;

  for (const [i, file] of files.entries()) {
    const full = path.join(MEDIA, file);
    const info = await stat(full);
    const remote = state[file];
    const unchanged = remote && remote.size === info.size && remote.mtimeMs === info.mtimeMs;

    if (!FORCE && unchanged) {
      skipped += 1;
      uploadedBytes += info.size;
      log(`· ${file} (unchanged)`);
      continue;
    }

    log(`↑ [${i + 1}/${files.length}] ${file} — ${(info.size / 1048576).toFixed(1)} MB`);
    const put = wrangler([
      'r2', 'object', 'put', `${BUCKET}/media/${file}`,
      '--file', full,
      '--remote',
      '--content-type', 'video/mp4',
      '--cache-control', 'public, max-age=604800',
    ]);
    if (!put.ok) fail(`upload failed for ${file}`, put.out);

    state[file] = { size: info.size, mtimeMs: info.mtimeMs };
    await writeFile(STATE, JSON.stringify(state, null, 2));
    uploadedBytes += info.size;
  }

  log(
    `✓ video ready — ${files.length - skipped} uploaded, ${skipped} already current ` +
      `(${(uploadedBytes / 1048576).toFixed(0)} MB total)`
  );
}

/* ---------------------------------------------------------------- build */
const pack = spawnSync(
  process.execPath,
  [path.join(ROOT, 'tools', 'pack.mjs'), `--media-base=${origin}/media`],
  { cwd: ROOT, encoding: 'utf8' }
);
if (pack.stdout) process.stdout.write(pack.stdout);
if (pack.status !== 0) fail('pack failed', pack.stderr || '');

/* --------------------------------------------------------------- pages */
const project = wrangler(['pages', 'project', 'create', PROJECT, '--production-branch', 'main']);
if (!project.ok && !/already exists|conflict/i.test(project.out)) {
  // Not fatal: an existing project may still be usable.
  log(`· project create returned: ${project.out.trim().split('\n').slice(-1)[0]}`);
} else if (project.ok) {
  log(`✓ Pages project ${PROJECT} created`);
} else {
  log(`✓ Pages project ${PROJECT}`);
}

log(`\n↑ deploying ${PROJECT} to Cloudflare Pages…`);
const deploy = wrangler(
  ['pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'],
  { quiet: false }
);
if (!deploy.ok) fail('Pages deploy failed', deploy.out);

console.log(`\n✓ live at https://${PROJECT}.pages.dev`);
console.log(`  video at ${origin}/media/`);
