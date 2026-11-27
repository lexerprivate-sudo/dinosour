/* Small helpers shared across the app. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const compactCache = new Map();
export function compact(n) {
  if (n == null) return '0';
  const key = String(n);
  let out = compactCache.get(key);
  if (out === undefined) {
    out = compactFmt.format(n).replace('.0', '');
    if (compactCache.size > 500) compactCache.clear();
    compactCache.set(key, out);
  }
  return out;
}

export function exact(n) {
  return Number(n || 0).toLocaleString('en-US');
}

export function fmtDuration(total) {
  const s = Math.max(0, Math.round(Number(total) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtTime(total) {
  return fmtDuration(total);
}

/** "3:55" / "1:02:03" -> seconds, for files that only carry a display label. */
export function parseLength(label) {
  const parts = String(label || '')
    .split(':')
    .map((p) => Number(p.trim()));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const TIME_UNITS = [
  [31536000, 'year'],
  [2592000, 'month'],
  [604800, 'week'],
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
];

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, (Date.now() - then) / 1000);
  if (diff < 45) return 'just now';
  for (const [secs, name] of TIME_UNITS) {
    const n = Math.floor(diff / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

const shadeCache = new Map();
export function shade(hex, percent) {
  const key = `${hex}|${percent}`;
  const cached = shadeCache.get(key);
  if (cached !== undefined) return cached;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((x) => {
    const v = parseInt(x, 16) + Math.round((percent / 100) * 255);
    return clamp(v, 0, 255);
  });
  const out = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  if (shadeCache.size > 200) shadeCache.clear();
  shadeCache.set(key, out);
  return out;
}

const avatarCache = new Map();
export function avatarStyle(color) {
  let out = avatarCache.get(color);
  if (out === undefined) {
    out = `background: linear-gradient(140deg, ${color}, ${shade(color, -28)});`;
    if (avatarCache.size > 200) avatarCache.clear();
    avatarCache.set(color, out);
  }
  return out;
}

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function uid(prefix = 'c') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Uniform Fisher–Yates shuffle (sort(() => Math.random() - 0.5) is biased). */
export function shuffleArray(values) {
  const out = [...(values || [])];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/* True inside the Android app. The app bundles this site and answers /api/*
   natively, so it hides the local film library and server-only features. */
export const APP_MODE =
  /dinosourApp/i.test(navigator.userAgent) ||
  location.hostname === 'dinosour.local' ||
  (() => {
    try {
      return localStorage.getItem('dinosour.appMode') === '1';
    } catch {
      return false;
    }
  })();
