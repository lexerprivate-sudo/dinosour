// Deploys the whole site — app + HLS video — to Cloudflare Pages.
// No object storage, no payment method, no bandwidth bill.
//
//   npm run login     # once
//   npm run cloud
//
// Options:
//   --force      rebuild every HLS folder from the MP4s
//   --skip-hls   reuse the existing media/hls output and only redeploy the app
//   --project    Pages project name (default: dinosour)

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PROJECT = option(
  'project',
  process.env.DINOSOUR_PROJECT || process.env.WATCH_PROJECT || process.env.TOT_PROJECT || 'dinosour'
);

function wrangler(args) {
  const res = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  return { ok: res.status === 0, out };
}

function run(script, args = []) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function fail(message, out = '') {
  console.error(`\n✗ ${message}`);
  if (out.trim()) console.error(out.trim().split('\n').slice(-14).join('\n'));
  process.exit(1);
}

const who = wrangler(['whoami']);
if (/not authenticated/i.test(who.out)) {
  fail(
    'Cloudflare is not connected yet.\n\n  Run this once, approve it in the browser, then deploy again:\n\n    npm run login\n'
  );
}
const email = who.out.match(/associated with the email ([^\s,]+)/i)?.[1];
console.log(`✓ Cloudflare account${email ? `: ${email}` : ''}`);

if (!flag('skip-hls')) {
  run('hls.mjs', flag('force') ? ['--force'] : []);
}
run('pack.mjs', ['--hls']);

const project = wrangler(['pages', 'project', 'create', PROJECT, '--production-branch', 'main']);
if (project.ok) console.log(`✓ Pages project ${PROJECT} created`);
else if (/already exists|conflict/i.test(project.out)) console.log(`✓ Pages project ${PROJECT}`);
else console.log(`· project create: ${project.out.trim().split('\n').slice(-1)[0]}`);

console.log(`\n↑ uploading to Cloudflare Pages (this can take a few minutes)…`);
const deploy = wrangler([
  'pages', 'deploy', 'dist',
  '--project-name', PROJECT,
  '--branch', 'main',
  '--commit-dirty=true',
]);
if (!deploy.ok) fail('Pages deploy failed', deploy.out);

console.log(`\n✓ live at https://${PROJECT}.pages.dev`);
