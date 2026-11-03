#!/usr/bin/env node
/**
 * Builds the dinosour Android app with the Android SDK directly.
 * No Gradle, no Android Studio, no dependencies.
 *
 *   node tools/android.mjs
 *
 * Output: mobile/dinosour.apk
 * The app is a thin client: it finds the dinosour server on the same Wi-Fi.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'mobile');
const BUILD = path.join(MOBILE, 'build');
const WIN = process.platform === 'win32';

const SDK =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (WIN
    ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
    : path.join(os.homedir(), 'Android', 'Sdk'));

if (!existsSync(SDK)) {
  console.error(`Android SDK not found. Set ANDROID_HOME. Looked in ${SDK}`);
  process.exit(1);
}

function byVersion(a, b) {
  const n = (s) => Number((s.match(/(\d+)/) || [])[1] || 0);
  return n(b) - n(a);
}

function pickDir(parent, prefix) {
  const dir = path.join(SDK, parent);
  if (!existsSync(dir)) return null;
  const names = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-ChildItem '${dir}' -Directory).Name`], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith(prefix))
    .sort(byVersion);
  return names.length ? path.join(dir, names[0]) : null;
}

const buildTools = pickDir('build-tools', '');
const platform35 = path.join(SDK, 'platforms', 'android-35');
const platform = existsSync(platform35) ? platform35 : pickDir('platforms', 'android-');
if (!buildTools || !platform) {
  console.error('Android build-tools or platform not installed. Open Android Studio > SDK Manager once.');
  process.exit(1);
}

const androidJar = path.join(platform, 'android.jar');
const tool = (name) => path.join(buildTools, name);
const aapt2 = tool('aapt2.exe');
const d8Jar = tool(path.join('lib', 'd8.jar'));
const zipalign = tool('zipalign.exe');
const apksignerJar = tool(path.join('lib', 'apksigner.jar'));

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

async function listFiles(dir, filter) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, filter)));
    else if (filter(full)) out.push(full);
  }
  return out;
}

async function main() {
  console.log(`Using ${path.basename(platform)} + build-tools ${path.basename(buildTools)}`);

  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const versionName = String(pkg.version || '1.0.0');
  const parts = versionName.split('.').map((n) => parseInt(n, 10) || 0);
  const versionCode = parts[0] * 10000 + parts[1] * 100 + (parts[2] || 0);
  console.log(`dinosour ${versionName} (${versionCode})`);

  await fs.rm(BUILD, { recursive: true, force: true });
  const gen = path.join(BUILD, 'gen');
  const classes = path.join(BUILD, 'classes');
  const dex = path.join(BUILD, 'dex');
  await fs.mkdir(gen, { recursive: true });
  await fs.mkdir(classes, { recursive: true });
  await fs.mkdir(dex, { recursive: true });

  const compiled = path.join(BUILD, 'resources.zip');
  console.log('• compiling resources');
  run(aapt2, ['compile', '--dir', path.join(MOBILE, 'res'), '-o', compiled]);

  console.log('• bundling the site');
  const assets = path.join(BUILD, 'assets');
  await fs.cp(path.join(ROOT, 'public'), path.join(assets, 'site'), { recursive: true });

  const unsigned = path.join(BUILD, 'app-unsigned.apk');
  console.log('• linking manifest');
  run(aapt2, [
    'link',
    '-o', unsigned,
    '-I', androidJar,
    '--manifest', path.join(MOBILE, 'AndroidManifest.xml'),
    '-R', compiled,
    '-A', assets,
    '--java', gen,
    '--min-sdk-version', '26',
    '--target-sdk-version', '35',
    '--version-code', String(versionCode),
    '--version-name', versionName,
    '--auto-add-overlay',
  ]);

  console.log('• compiling Java');
  const sources = [
    ...(await listFiles(path.join(MOBILE, 'java'), (f) => f.endsWith('.java'))),
    ...(await listFiles(gen, (f) => f.endsWith('.java'))),
  ];
  run('javac', [
    '-encoding', 'UTF-8',
    '--release', '8',
    '-classpath', androidJar,
    '-d', classes,
    ...sources,
  ]);

  console.log('• dexing');
  const classFiles = await listFiles(classes, (f) => f.endsWith('.class'));
  run('java', ['-cp', d8Jar, 'com.android.tools.r8.D8', '--release', '--lib', androidJar, '--min-api', '26', '--output', dex, ...classFiles]);

  console.log('• packaging');
  const zipScript = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = [System.IO.Compression.ZipFile]::Open('${unsigned.replace(/'/g, "''")}', 'Update')`,
    `[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, '${path.join(dex, 'classes.dex').replace(/'/g, "''")}', 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal)`,
    '$zip.Dispose()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', zipScript], { stdio: 'inherit' });

  const aligned = path.join(BUILD, 'app-aligned.apk');
  console.log('• aligning');
  run(zipalign, ['-f', '-p', '4', unsigned, aligned]);

  const keystore = path.join(MOBILE, 'debug.keystore');
  if (!existsSync(keystore)) {
    console.log('• creating debug keystore');
    run('keytool', [
      '-genkeypair', '-v',
      '-keystore', keystore,
      '-storepass', 'android',
      '-alias', 'androiddebugkey',
      '-keypass', 'android',
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-dname', 'CN=Android Debug,O=Android,C=US',
    ]);
  }

  const out = path.join(MOBILE, 'dinosour.apk');
  console.log('• signing');
  run('java', [
    '-jar', apksignerJar,
    'sign',
    '--ks', keystore,
    '--ks-pass', 'pass:android',
    '--key-pass', 'pass:android',
    '--out', out,
    aligned,
  ]);
  run('java', ['-jar', apksignerJar, 'verify', '--print-certs', out]);

  const stat = await fs.stat(out);
  console.log(`\n✓ ${out}`);
  console.log(`  ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log('  Install with: adb install -r mobile/dinosour.apk');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
