/* A YouTube-style video player built on a plain <video> element. */

import { icon, fmtDuration, clamp, isTypingTarget, compact } from './util.js';
import { store } from './store.js';
import { attachStream, detachStream } from './stream.js';

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class Player {
  constructor(root, video, { next = null, onNavigate, onToast, onResume } = {}) {
    this.root = root;
    this.video = video;
    this.next = next;
    this.onNavigate = onNavigate;
    this.onToast = onToast || (() => {});
    this.onResume = onResume;
    this.loop = false;
    this.destroyed = false;
    this.hideTimer = null;
    this.countdownTimer = null;
    this.saveTick = 0;
    this.endedShown = false;
    this.abort = new AbortController();
    this.build();
    this.wire();
    this.restore();
    this.attachSource();
  }

  build() {
    const v = this.video;
    const next = this.next;
    const nextThumb = next ? next.thumb : '';
    const nextTitle = next ? next.title : '';
    const nextChannel = next ? next.channelData.name : '';
    const nextMeta = next ? `${compact(next.views)} views · ${next.channelData.name}` : '';

    this.root.innerHTML = `
      <video poster="${v.thumb}" playsinline preload="metadata"></video>
      <div class="player-spinner"><div class="spinner"></div></div>
      <div class="player-title-fs">${escapeText(v.title)}</div>
      <button class="big-play" data-act="toggle" aria-label="Play">
        <span class="big-play-btn">${icon('play', 'fill')}</span>
      </button>

      <div class="end-card" aria-live="polite">
        ${next ? `
        <div class="end-main">
          <div class="end-label">Up next</div>
          <div class="end-body">
            <a class="end-thumb" href="/watch/${next.id}" data-link><img src="${nextThumb}" alt=""></a>
            <div>
              <a href="/watch/${next.id}" data-link><div class="end-title">${escapeText(nextTitle)}</div></a>
              <div class="end-sub">${escapeText(nextMeta)}</div>
            </div>
          </div>
          <div class="end-progress"><i></i></div>
        </div>
        <div class="end-actions">
          <span class="end-count" data-count></span>
          <button class="btn-ghost" data-act="cancel">Cancel</button>
          <button class="btn-light" data-act="next">Play now</button>
        </div>` : `
        <div class="end-main">
          <div class="end-label">That's all</div>
          <div class="end-title">You've reached the end of this one.</div>
        </div>
        <div class="end-actions">
          <button class="btn-light" data-act="replay">${icon('play', 'fill')} Replay</button>
        </div>`}
      </div>

      <div class="controls">
        <div class="progress" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
          <div class="progress-track">
            <div class="progress-buffer"></div>
            <div class="progress-played"></div>
          </div>
          <div class="progress-tip">0:00</div>
        </div>
        <div class="controls-row">
          <button class="pc-btn" data-act="toggle" aria-label="Play">${icon('play', 'fill')}</button>
          <button class="pc-btn" data-act="next" aria-label="Next video" ${next ? '' : 'disabled style="opacity:.35"'}>${icon('next')}</button>
          <div class="pc-volume">
            <button class="pc-btn" data-act="mute" aria-label="Mute">${icon('volume')}</button>
            <div class="pc-vol-slider"><input type="range" class="vol" min="0" max="100" value="100" aria-label="Volume"></div>
          </div>
          <span class="pc-time"><span data-cur>0:00</span> / <span data-dur>0:00</span></span>
          <span class="pc-spacer"></span>
          <button class="pc-btn" data-act="speed" aria-label="Playback speed"><span class="pc-speed-badge">1×</span></button>
          <button class="pc-btn" data-act="settings" aria-label="Settings">${icon('sliders')}</button>
          <button class="pc-btn" data-act="pip" aria-label="Picture in picture">${icon('pip')}</button>
          <button class="pc-btn" data-act="theater" aria-label="Theater mode">${icon('theater')}</button>
          <button class="pc-btn" data-act="fullscreen" aria-label="Fullscreen">${icon('fullscreen')}</button>
        </div>
        <div class="pc-menu" hidden></div>
      </div>`;

    this.el = this.root;
    this.media = this.el.querySelector('video');
    this.progress = this.el.querySelector('.progress');
    this.track = this.el.querySelector('.progress-track');
    this.played = this.el.querySelector('.progress-played');
    this.buffered = this.el.querySelector('.progress-buffer');
    this.tip = this.el.querySelector('.progress-tip');
    this.cur = this.el.querySelector('[data-cur]');
    this.dur = this.el.querySelector('[data-dur]');
    this.menu = this.el.querySelector('.pc-menu');
    this.endCard = this.el.querySelector('.end-card');
    this.endProgress = this.el.querySelector('.end-progress > i');
    this.endCount = this.el.querySelector('[data-count]');
    this.playBtn = this.el.querySelector('.controls-row [data-act="toggle"]');
    this.muteBtn = this.el.querySelector('[data-act="mute"]');
    this.vol = this.el.querySelector('.vol');
    this.speedBadge = this.el.querySelector('.pc-speed-badge');
    this.nextBtn = this.el.querySelector('.controls-row [data-act="next"]');
    this.hls = null;
    this.streamToken = 0;

    this.media.volume = store.state.volume ?? 1;
    this.media.muted = !!store.state.muted;
    this.media.playbackRate = store.state.rate || 1;
    this.syncVolume();
    this.syncRate();
  }

  wire() {
    const { signal } = this.abort;
    const m = this.media;

    this.root.addEventListener('pointermove', () => this.reveal(), { signal });
    this.root.addEventListener('pointerleave', () => this.scheduleHide(), { signal });
    this.root.addEventListener('click', (e) => this.onRootClick(e), { signal });
    this.root.addEventListener('dblclick', (e) => {
      if (e.target.closest('.controls') || e.target.closest('.end-card')) return;
      this.toggleFullscreen();
    }, { signal });

    m.addEventListener('loadedmetadata', () => this.onMetadata(), { signal });
    m.addEventListener('durationchange', () => this.paintTime(), { signal });
    m.addEventListener('timeupdate', () => { this.paintTime(); this.maybeSave(); }, { signal });
    m.addEventListener('progress', () => this.paintBuffer(), { signal });
    m.addEventListener('play', () => {
      this.el.classList.remove('paused', 'ended');
      this.el.classList.add('playing');
      this.updatePlayIcon();
      this.scheduleHide();
      store.addHistory(this.video.id);
    }, { signal });
    m.addEventListener('pause', () => {
      this.el.classList.add('paused');
      this.el.classList.remove('playing');
      this.reveal(true);
      this.updatePlayIcon();
      this.saveProgress();
    }, { signal });
    m.addEventListener('waiting', () => this.el.classList.add('buffering'), { signal });
    m.addEventListener('playing', () => this.el.classList.remove('buffering'), { signal });
    m.addEventListener('canplay', () => this.el.classList.remove('buffering'), { signal });
    m.addEventListener('ended', () => this.onEnded(), { signal });
    m.addEventListener('error', () => {
      this.el.classList.remove('buffering');
      this.onToast('This video could not be loaded.');
    }, { signal });
    m.addEventListener('volumechange', () => this.syncVolume(), { signal });
    m.addEventListener('ratechange', () => this.syncRate(), { signal });

    this.progress.addEventListener('pointerdown', (e) => this.startScrub(e), { signal });
    this.progress.addEventListener('pointermove', (e) => this.hoverScrub(e), { signal });
    this.progress.addEventListener('pointerleave', () => this.progress.classList.remove('hovering'), { signal });
    this.progress.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        this.seekBy(e.key === 'ArrowRight' ? 5 : -5);
      }
    }, { signal });

    this.el.querySelectorAll('[data-act="toggle"]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); }, { signal })
    );
    this.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); this.goNext(); }, { signal });
    this.muteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMute(); }, { signal });
    this.vol.addEventListener('input', () => {
      const val = Number(this.vol.value) / 100;
      this.media.muted = false;
      this.media.volume = val;
      store.set('volume', val);
      store.set('muted', false);
    }, { signal });

    this.el.querySelector('[data-act="settings"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    }, { signal });
    this.el.querySelector('[data-act="speed"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    }, { signal });
    this.el.querySelector('[data-act="pip"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await this.media.requestPictureInPicture();
      } catch {
        this.onToast('Picture-in-picture is not available here.');
      }
    }, { signal });
    this.el.querySelector('[data-act="theater"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTheater();
    }, { signal });
    this.el.querySelector('[data-act="fullscreen"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    }, { signal });

    this.endCard.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'next') this.goNext();
      else if (act === 'cancel') this.dismissEndCard();
      else if (act === 'replay') {
        this.hideEndCard();
        this.media.currentTime = 0;
        this.safePlay();
      }
    }, { signal });

    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !e.target.closest('.pc-menu') && !e.target.closest('[data-act="settings"]') && !e.target.closest('[data-act="speed"]')) {
        this.menu.hidden = true;
      }
    }, { signal });

    document.addEventListener('fullscreenchange', () => {
      const fs = document.fullscreenElement === this.el;
      const btn = this.el.querySelector('[data-act="fullscreen"]');
      if (btn) btn.innerHTML = icon(fs ? 'fullscreen-exit' : 'fullscreen');
    }, { signal });

    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey, { signal });
  }

  restore() {
    this.el.classList.add('paused');
    this.paintTime();
    this.syncVolume();
  }

  async attachSource() {
    const token = ++this.streamToken;
    const hls = await attachStream(this.media, this.video.src, {
      onFatal: () => {
        if (this.destroyed) return;
        this.el.classList.remove('buffering');
        this.onToast('This video could not be loaded.');
      },
    });
    if (this.destroyed || token !== this.streamToken) {
      detachStream(hls);
      return;
    }
    this.hls = hls;
  }

  onMetadata() {
    const d = this.media.duration;
    this.dur.textContent = fmtDuration(d);
    this.progress.setAttribute('aria-valuemax', String(Math.round(d)));
    this.paintBuffer();

    const saved = store.getProgress(this.video.id);
    if (saved && saved.t > 4 && d - saved.t > 8) {
      this.media.currentTime = saved.t;
      this.onResume?.(saved, this);
    }
  }

  onRootClick(e) {
    if (this.destroyed) return;
    const act = e.target.closest('[data-act]');
    if (act) return; // dedicated handlers
    if (e.target.closest('.controls') || e.target.closest('.end-card')) return;
    if (e.target.closest('a')) return;
    this.toggle();
  }

  toggle() {
    if (this.media.paused) this.safePlay();
    else this.media.pause();
  }

  safePlay() {
    const p = this.media.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        this.el.classList.add('paused');
        this.onToast('Press play to start the video.');
      });
    }
  }

  seekBy(seconds) {
    const d = this.media.duration || 0;
    if (!d) return;
    this.media.currentTime = clamp(this.media.currentTime + seconds, 0, d - 0.1);
    this.reveal();
  }

  ratioFromEvent(e) {
    const rect = this.track.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
  }

  startScrub(e) {
    if (!this.media.duration) return;
    e.preventDefault();
    this.progress.classList.add('dragging');
    this.progress.setPointerCapture?.(e.pointerId);
    this.media.pause();
    const move = (ev) => {
      const r = this.ratioFromEvent(ev);
      this.media.currentTime = r * this.media.duration;
      this.paintTime();
      this.showTip(ev);
    };
    const up = (ev) => {
      this.progress.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.media.currentTime = this.ratioFromEvent(ev) * this.media.duration;
      this.paintTime();
      this.saveProgress();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    this.media.currentTime = this.ratioFromEvent(e) * this.media.duration;
    this.paintTime();
  }

  hoverScrub(e) {
    if (!this.media.duration) return;
    this.progress.classList.add('hovering');
    this.showTip(e);
  }

  showTip(e) {
    const ratio = this.ratioFromEvent(e);
    const rect = this.track.getBoundingClientRect();
    const host = this.progress.getBoundingClientRect();
    this.tip.textContent = fmtDuration(ratio * this.media.duration);
    const x = clamp(rect.left - host.left + ratio * rect.width, 24, host.width - 24);
    this.tip.style.left = `${x}px`;
  }

  paintTime() {
    const d = this.media.duration || 0;
    const t = this.media.currentTime || 0;
    this.cur.textContent = fmtDuration(t);
    if (d) this.dur.textContent = fmtDuration(d);
    const pct = d ? (t / d) * 100 : 0;
    this.played.style.width = `${pct}%`;
    this.progress.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  paintBuffer() {
    const d = this.media.duration || 0;
    if (!d) return;
    const b = this.media.buffered;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= this.media.currentTime + 0.5) end = Math.max(end, b.end(i));
      else end = Math.max(end, b.end(i));
    }
    this.buffered.style.width = `${clamp((end / d) * 100, 0, 100)}%`;
  }

  updatePlayIcon() {
    const playing = !this.media.paused && !this.media.ended;
    this.playBtn.innerHTML = icon(playing ? 'pause' : 'play', playing ? 'fill' : 'fill');
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  syncVolume() {
    const muted = this.media.muted || this.media.volume === 0;
    this.muteBtn.innerHTML = icon(muted ? 'mute' : 'volume');
    this.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    const val = Math.round((this.media.muted ? 0 : this.media.volume) * 100);
    this.vol.value = String(val);
    this.vol.style.setProperty('--val', `${val}%`);
    store.state.volume = this.media.volume;
    store.state.muted = this.media.muted;
    store.save();
  }

  syncRate() {
    const r = this.media.playbackRate;
    this.speedBadge.textContent = `${r}×`;
    store.set('rate', r);
  }

  toggleMute() {
    this.media.muted = !this.media.muted;
    if (!this.media.muted && this.media.volume === 0) this.media.volume = 0.6;
    store.set('muted', this.media.muted);
  }

  toggleTheater() {
    if (window.innerWidth < 900) {
      this.onToast('Theater mode needs a wider window.');
      return;
    }
    document.body.classList.toggle('theater');
    const on = document.body.classList.contains('theater');
    if (on) window.scrollTo({ top: 0, behavior: 'smooth' });
    this.onToast(on ? 'Theater mode on' : 'Theater mode off');
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.el.requestFullscreen();
    } catch {
      this.onToast('Fullscreen is not available here.');
    }
  }

  toggleMenu() {
    if (!this.menu.hidden) {
      this.menu.hidden = true;
      return;
    }
    this.menu.innerHTML = `
      <div class="pc-menu-title">Playback speed</div>
      ${RATES.map(
        (r) => `<button data-rate="${r}">${r === 1 ? 'Normal' : `${r}×`}<span class="pc-check">${this.media.playbackRate === r ? icon('check') : ''}</span></button>`
      ).join('')}
      <div class="sep"></div>
      <button data-loop>Loop video<span class="pc-check">${this.loop ? icon('check') : ''}</span></button>`;
    this.menu.querySelectorAll('[data-rate]').forEach((b) =>
      b.addEventListener('click', () => {
        this.media.playbackRate = Number(b.dataset.rate);
        this.menu.hidden = true;
        this.onToast(`Speed ${b.textContent.trim()}`);
      })
    );
    this.menu.querySelector('[data-loop]').addEventListener('click', () => {
      this.loop = !this.loop;
      this.media.loop = this.loop;
      this.menu.hidden = true;
      this.onToast(this.loop ? 'Looping this video' : 'Loop off');
    });
    this.menu.hidden = false;
  }

  reveal(force = false) {
    this.el.classList.add('show-controls');
    this.el.classList.remove('hide-cursor');
    clearTimeout(this.hideTimer);
    if (!force) this.scheduleHide();
  }

  scheduleHide() {
    clearTimeout(this.hideTimer);
    if (this.media.paused) return;
    this.hideTimer = setTimeout(() => {
      if (this.media.paused || this.menu.hidden === false || this.progress.classList.contains('dragging')) return;
      this.el.classList.remove('show-controls');
      this.el.classList.add('hide-cursor');
    }, 2600);
  }

  maybeSave() {
    const now = Date.now();
    if (now - this.saveTick > 3000) {
      this.saveTick = now;
      this.saveProgress();
    }
  }

  saveProgress() {
    const d = this.media.duration;
    const t = this.media.currentTime;
    if (d && Number.isFinite(d)) store.setProgress(this.video.id, t, d);
  }

  onEnded() {
    this.el.classList.remove('paused', 'playing');
    this.el.classList.add('ended');
    this.saveProgress();
    if (!this.next) {
      this.el.classList.remove('ended');
      this.el.classList.add('paused');
      return;
    }
    this.showEndCard();
  }

  showEndCard() {
    this.endCard.classList.add('visible');
    this.el.classList.add('show-controls');
    clearInterval(this.countdownTimer);

    if (!store.state.autoplay) {
      if (this.endCount) this.endCount.textContent = 'Autoplay is off';
      if (this.endProgress) this.endProgress.style.width = '0%';
      return;
    }

    const total = 6000;
    const started = Date.now();
    const tick = () => {
      const left = total - (Date.now() - started);
      if (this.endCount) this.endCount.textContent = `Next in ${Math.max(0, Math.ceil(left / 1000))}`;
      if (this.endProgress) this.endProgress.style.width = `${clamp(100 - (left / total) * 100, 0, 100)}%`;
      if (left <= 0) {
        clearInterval(this.countdownTimer);
        this.goNext();
      }
    };
    tick();
    this.countdownTimer = setInterval(tick, 100);
  }

  hideEndCard() {
    this.endCard.classList.remove('visible');
    clearInterval(this.countdownTimer);
  }

  dismissEndCard() {
    this.hideEndCard();
    this.el.classList.remove('ended');
    this.el.classList.add('paused');
    this.reveal(true);
  }

  goNext() {
    if (!this.next) return;
    clearInterval(this.countdownTimer);
    this.saveProgress();
    this.onNavigate?.(`/watch/${this.next.id}`);
  }

  handleKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    const key = e.key;
    if (key === ' ' || key.toLowerCase() === 'k') {
      e.preventDefault();
      this.toggle();
    } else if (key.toLowerCase() === 'j') {
      this.seekBy(-10);
    } else if (key.toLowerCase() === 'l') {
      this.seekBy(10);
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      this.seekBy(-5);
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      this.seekBy(5);
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      this.media.muted = false;
      this.media.volume = clamp(this.media.volume + 0.05, 0, 1);
      this.reveal();
    } else if (key === 'ArrowDown') {
      e.preventDefault();
      this.media.volume = clamp(this.media.volume - 0.05, 0, 1);
      this.reveal();
    } else if (key.toLowerCase() === 'm') {
      this.toggleMute();
      this.reveal();
    } else if (key.toLowerCase() === 'f') {
      this.toggleFullscreen();
    } else if (key.toLowerCase() === 't') {
      this.toggleTheater();
    } else if (key === 'Escape') {
      if (!this.menu.hidden) this.menu.hidden = true;
    } else if (/^[0-9]$/.test(key)) {
      const d = this.media.duration;
      if (d) this.media.currentTime = (Number(key) / 10) * d;
      this.reveal();
    } else if (key === '>' || (key === '.' && e.shiftKey)) {
      this.bumpRate(1);
    } else if (key === '<' || (key === ',' && e.shiftKey)) {
      this.bumpRate(-1);
    }
  }

  bumpRate(dir) {
    const idx = RATES.indexOf(this.media.playbackRate);
    const nextIdx = clamp((idx === -1 ? 3 : idx) + dir, 0, RATES.length - 1);
    this.media.playbackRate = RATES[nextIdx];
    this.reveal();
    this.onToast(`Speed ${RATES[nextIdx]}×`);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.hideTimer);
    clearInterval(this.countdownTimer);
    this.abort.abort();
    document.removeEventListener('keydown', this.onKey);
    try {
      this.saveProgress();
      this.media.pause();
      this.streamToken += 1;
      detachStream(this.hls);
      this.hls = null;
      this.media.removeAttribute('src');
      this.media.load();
    } catch { /* noop */ }
    document.body.classList.remove('theater');
  }
}

function escapeText(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
