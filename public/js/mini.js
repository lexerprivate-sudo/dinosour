/* Floating mini player: keeps a YouTube video going while you browse. */

import { store } from './store.js';
import { APP_MODE, esc } from './util.js';
import { navigate } from './ui.js';
import { clearMediaTarget, isAppVisible, reportMedia, setMediaTarget, stopMedia } from './media.js';

const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

let miniEl = null;
let frame = null;
let timer = null;
let lastSave = 0;
let tries = 0;
let reportedPlaying = false;
let pausedByUser = false;
let pausedAt = 0;
let wantPlaying = false;
let lastAdvance = 0;
let lastNudge = 0;
let keepAliveTimer = null;

let track = {
  id: '',
  title: '',
  channel: '',
  thumb: '',
  position: 0,
  duration: 0,
};

function paintProgress() {
  const bar = miniEl?.querySelector('[data-mini-progress]');
  if (!bar) return;
  const pct = track.duration
    ? Math.min(100, Math.max(0, (track.position / track.duration) * 100))
    : 0;
  bar.style.width = `${pct}%`;
}

function setMiniPlaying(next) {
  if (next === reportedPlaying) return;
  reportedPlaying = next;
  reportMedia(next, track.title, track.channel);
}

/* Lock-screen and notification buttons drive the mini player. */
const mediaTarget = {
  play() {
    pausedByUser = false;
    wantPlaying = true;
    lastAdvance = Date.now();
    setMiniPlaying(true);
    send({ event: 'command', func: 'playVideo', args: [] });
  },
  pause() {
    pausedByUser = true;
    wantPlaying = false;
    pausedAt = Date.now();
    setMiniPlaying(false);
    send({ event: 'command', func: 'pauseVideo', args: [] });
  },
  stop() {
    closeMini();
  },
};

/* Retry playVideo only while the app is backgrounded and playback is wanted.
   This counteracts YouTube pausing a hidden embed without fighting a manual
   pause from the notification or lock screen. */
function nudgePlayback() {
  if (!miniEl || !frame || isAppVisible() || !wantPlaying || pausedByUser) return;
  const now = Date.now();
  if (now - lastNudge < 3000 || now - lastAdvance < 3500) return;
  lastNudge = now;
  send({ event: 'command', func: 'playVideo', args: [] });
}

function onAppVisibility(event) {
  const visible = !!event.detail?.visible;
  if (visible) {
    lastNudge = 0;
    return;
  }
  if (pausedByUser || !frame) return;
  const recentlyPlaying = wantPlaying || Date.now() - lastAdvance < 2500;
  if (!recentlyPlaying) return;
  wantPlaying = true;
  lastAdvance = Date.now();
  lastNudge = 0;
  send({ event: 'command', func: 'playVideo', args: [] });
}

function save(force = false) {
  if (!track.id || !track.duration || !track.position) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  store.saveResume({
    id: track.id,
    title: track.title,
    channel: track.channel,
    thumb: track.thumb,
    t: track.position,
    d: track.duration,
  });
}

function send(payload) {
  try {
    frame?.contentWindow?.postMessage(JSON.stringify(payload), '*');
  } catch {
    /* the frame went away */
  }
}

function listen() {
  if (!frame) return;
  send({ event: 'listening', id: `dinosour-mini-${track.id}` });
}

function onMessage(event) {
  if (!frame || event.source !== frame.contentWindow) return;
  let data = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return;
    }
  }
  if (!data || typeof data !== 'object') return;

  if (data.event === 'onReady' || data.event === 'initialDelivery') {
    const rate = Number(store.state.ytRate);
    send({
      event: 'command',
      func: 'setPlaybackRate',
      args: [Number.isFinite(rate) && rate > 0 ? rate : 1],
    });
  }

  const info = data.info;
  if (!info || typeof info !== 'object') return;

  if (typeof info.duration === 'number' && info.duration > 0) track.duration = info.duration;

  if (typeof info.currentTime === 'number') {
    // Some embeds omit playerState, so advancing time also means "playing".
    // Never re-send a pause from here; a stale tick after resume used to stop
    // playback again and again.
    const advancing = info.currentTime > track.position + 0.05;
    if (advancing && !pausedByUser) {
      wantPlaying = true;
      lastAdvance = Date.now();
      setMiniPlaying(true);
    }
    track.position = info.currentTime;
    paintProgress();
    if (track.duration && track.position >= track.duration - 2) {
      store.removeResume(track.id);
      closeMini({ savePosition: false });
      return;
    }
    if (track.position > 4) save();
  }

  if (info.playerState === 1) {
    pausedByUser = false;
    wantPlaying = true;
    lastAdvance = Date.now();
    setMiniPlaying(true);
  } else if (info.playerState === 0 || info.playerState === 2) {
    if (info.playerState === 0) {
      wantPlaying = false;
      store.removeResume(track.id);
      closeMini({ savePosition: false });
      return;
    }
    if (!isAppVisible()) {
      if (wantPlaying && !pausedByUser) lastAdvance = 0;
    } else {
      wantPlaying = false;
    }
    // Paused right now, but not necessarily paused by the user. Leave the flag
    // alone so a stale progress tick cannot be mistaken for a resume.
    setMiniPlaying(false);
  }
}

function onHide() {
  if (document.visibilityState === 'hidden') save(true);
}

function onPageHide() {
  save(true);
}

export function miniOpen() {
  return !!miniEl;
}

export function closeMini({ savePosition = true } = {}) {
  if (!miniEl) return;
  if (savePosition) save(true);
  clearTimeout(timer);
  timer = null;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
  wantPlaying = false;
  clearMediaTarget(mediaTarget);
  reportedPlaying = false;
  stopMedia();
  window.removeEventListener('message', onMessage);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('dinosour:appvisibility', onAppVisibility);
  miniEl.remove();
  miniEl = null;
  frame = null;
}

export function openMini(video) {
  closeMini({ savePosition: false });
  if (!video?.id) return;

  track = {
    id: video.id,
    title: video.title || 'YouTube video',
    channel: video.channel || 'YouTube',
    thumb: video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`,
    position: Number(video.position) || 0,
    duration: Number(video.duration) || 0,
  };
  lastSave = 0;
  tries = 0;
  wantPlaying = true;
  lastAdvance = Date.now();
  lastNudge = 0;

  miniEl = document.createElement('div');
  miniEl.className = 'mini-player';
  miniEl.innerHTML = `
    <div class="mini-video">
      <iframe class="mini-frame" title="${esc(track.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
      <div class="mini-actions">
        <button class="mini-btn" type="button" data-mini-expand aria-label="Back to video" title="Back to video">${icon('pip')}</button>
        <button class="mini-btn" type="button" data-mini-close aria-label="Close mini player" title="Close mini player">${icon('x')}</button>
      </div>
      <div class="mini-caption">
        <div class="mini-title">${esc(track.title)}</div>
        <div class="mini-channel">${esc(track.channel)}</div>
      </div>
      <div class="mini-progress" aria-hidden="true"><i data-mini-progress></i></div>
    </div>`;
  document.body.append(miniEl);

  frame = miniEl.querySelector('.mini-frame');
  const start =
    track.position >= 4 && (!track.duration || track.position < track.duration - 6)
      ? `&start=${Math.floor(track.position)}`
      : '';
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
    track.id
  )}?autoplay=1&rel=0&modestbranding=1&playsinline=1&color=white&enablejsapi=1${start}${
    APP_MODE ? '' : `&origin=${encodeURIComponent(location.origin)}`
  }`;

  miniEl.querySelector('[data-mini-close]').addEventListener('click', () => closeMini());
  frame.addEventListener('load', () => {
    tries = 0;
    ping();
  });

  const ping = () => {
    listen();
    tries += 1;
    if (tries < 8) timer = setTimeout(ping, 1200);
  };

  miniEl.querySelector('[data-mini-expand]').addEventListener('click', () => {
    const id = track.id;
    save(true);
    closeMini({ savePosition: false });
    navigate(`/watch/yt/${encodeURIComponent(id)}?autoplay=1`);
  });

  window.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('dinosour:appvisibility', onAppVisibility);
  keepAliveTimer = setInterval(nudgePlayback, 2000);
  setMediaTarget(mediaTarget);
}
