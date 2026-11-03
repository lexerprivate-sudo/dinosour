#!/usr/bin/env node
/**
 * Cuts a new dinosour release and uploads the APK to GitHub Releases.
 *
 *   npm run release            # 1.0.0 -> 1.0.1
 *   npm run release -- minor   # 1.0.1 -> 1.1.0
 *   npm run release -- 2.0.0   # explicit version
 *
 * The phone checks the latest release on launch and installs it over the old
 * app, so there is no uninstall/reinstall step.
 *
 * Needs git (with a github.com credential) or a GH_TOKEN/GITHUB_TOKEN with
 * repository access.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(ROOT, 'package.json');
const apkPath = path.join(ROOT, 'mobile', 'dinosour.apk');

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function credentialToken() {
  const result = spawnSync('git', ['credential', 'fill'], {
    cwd: ROOT,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const line = (result.stdout || '').split(/\r?\n/).find((l) => l.startsWith('password='));
  return line ? line.slice('password='.length) : '';
}

function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split('.').map((n) => Number(n) || 0);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function api(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `token ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dinosour-release',
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!response.ok) {
    fail(`${options.method || 'GET'} ${url} failed: ${response.status} ${data?.message || text.slice(0, 200)}`);
  }
  return data;
}

async function main() {
  const kind = process.argv[2] || 'patch';

  if (git('status', '--porcelain')) {
    fail('Commit or stash your changes first, then run the release again.');
  }

  const remote = git('remote', 'get-url', 'origin');
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) fail('The origin remote is not a GitHub repository.');
  const [, owner, repo] = match;

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || credentialToken();
  if (!token) fail('No GitHub credential found. Set GH_TOKEN or sign in with git.');

  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  const version = nextVersion(pkg.version, kind);
  if (version === pkg.version) fail(`Version is already ${version}.`);

  pkg.version = version;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`\n• dinosour ${version}`);

  console.log('• building the APK');
  execFileSync(process.execPath, ['tools/android.mjs'], { cwd: ROOT, stdio: 'inherit' });
  if (!existsSync(apkPath)) fail('The APK was not built.');

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('add', 'package.json');
  git('commit', '-m', `v${version}`);
  git('push', 'origin', `HEAD:${branch}`);
  console.log('• pushed the version bump');

  const release = await api(`https://api.github.com/repos/${owner}/${repo}/releases`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tag_name: `v${version}`,
      name: `v${version}`,
      target_commitish: branch,
      body: `dinosour ${version}`,
    }),
  });

  console.log('• uploading the APK');
  const apk = await fs.readFile(apkPath);
  const asset = await api(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=dinosour.apk`,
    token,
    {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.android.package-archive' },
      body: apk,
    }
  );

  // Keep a copy handy for sideloading.
  const desktop = path.join(os.homedir(), 'Desktop');
  if (process.platform === 'win32' && existsSync(desktop)) {
    await fs.copyFile(apkPath, path.join(desktop, 'dinosour.apk'));
  }

  console.log(`\n✓ ${release.html_url}`);
  console.log(`  ${asset.name}  ${(asset.size / 1024).toFixed(0)} KB`);
  console.log('  Installed phones will offer this update on their next launch.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
