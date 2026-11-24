#!/usr/bin/env node
/**
 * Builds the dinosour Android app with Gradle.
 * The native player module (android/) lives in its own Gradle project that
 * pulls in ExoPlayer and the NewPipe extractor, then compiles the existing
 * WebView app sources on top of it.
 *
 *   node tools/android.mjs
 *
 * Output: mobile/dinosour.apk
 */
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = path.join(ROOT, 'mobile');
const ANDROID = path.join(ROOT, 'android');
const BUILD = path.join(ANDROID, 'app', 'build');
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

const GRADLE =
  process.env.DINOSOUR_GRADLE ||
  path.join(
    os.homedir(),
    '.gradle',
    'wrapper',
    'dists',
    'gradle-8.14.3-all',
    '10utluxaxniiv4wxiphsi49nj',
    'gradle-8.14.3',
    'bin',
    'gradle.bat'
  );
const JAVA_HOME = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot';

function runGradle(args) {
  execFileSync(
    'cmd.exe',
    ['/c', `${GRADLE} ${args.join(' ')}`],
    {
      cwd: ANDROID,
      stdio: 'inherit',
      env: { ...process.env, JAVA_HOME, ANDROID_HOME: SDK, PATH: `${JAVA_HOME}\\bin;${process.env.PATH}` },
    }
  );
}

async function main() {
  console.log(`Using Android SDK ${path.basename(path.join(SDK, 'platforms'))} at ${SDK}`);

  // Keep the WebView bundle in lockstep with the web app. A manual copy used
  // to be easy to forget, which shipped an APK running older JS than the site.
  const siteFrom = path.join(ROOT, 'public');
  const siteTo = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'site');
  await fs.cp(siteFrom, siteTo, { recursive: true, force: true });
  console.log('• synced public/ → Android assets/site/');

  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const versionName = String(pkg.version || '1.0.0');
  const parts = versionName.split('.').map((n) => parseInt(n, 10) || 0);
  const versionCode = parts[0] * 10000 + parts[1] * 100 + (parts[2] || 0);
  console.log(`dinosour ${versionName} (${versionCode})`);

  runGradle(['assembleDebug', `-PversionCode=${versionCode}`, `-PversionName=${versionName}`]);

  const src = path.join(BUILD, 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(src)) throw new Error(`Expected APK at ${src}`);
  const out = path.join(MOBILE, 'dinosour.apk');
  await fs.copyFile(src, out);

  const stat = await fs.stat(out);
  console.log(`\n✓ ${out}`);
  console.log(`  ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log('  Install with: adb install -r mobile/dinosour.apk');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
