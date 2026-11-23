/* Discoverable music mixes: watch-page Mix button, mix page, mixes library. */

import { store } from './store.js';
import { emptyState } from './components.js';
import { esc } from './util.js';
import { navigate, toast } from './ui.js';
import { searchYouTube } from './yt.js';
import { buildMix } from './mix.js';

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function queueAttrs(v) {
  return `data-add-queue="${esc(v.id)}" data-q-title="${esc(v.title)}" data-q-channel="${esc(
    v.channel || 'YouTube'
  )}" data-q-thumb="${esc(v.thumb)}" data-q-length="${esc(v.length || '')}"`;
}

function mixTrackHtml(v, i) {
  return `<div class="mix-track">
    <span class="mix-index">${i + 1}</span>
    <a class="mix-track-link" href="/watch/yt/${encodeURIComponent(v.id)}?autoplay=1" data-link>
      <span class="mix-thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" width="120" height="68">
        ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
      </span>
      <span class="mix-track-text">
        <span class="mix-track-title">${esc(v.title)}</span>
        <span class="mix-track-channel">${esc(v.channel || 'YouTube')}</span>
      </span>
    </a>
    <button type="button" class="mix-add" ${queueAttrs(v)} aria-label="Add to Up Next" title="Add to Up Next">${icon('plus')}</button>
  </div>`;
}

export function renderMix(id) {
  const mix = store.mixById(id);
  if (!mix) {
    return `<div class="page">${emptyState({
      iconName: 'music',
      title: 'Mix not found',
      text: 'Open a song and tap Mix to create one.',
      actionHref: '/',
      actionText: 'Browse home',
    })}</div>`;
  }
  const tracks = mix.tracks || [];
  const seed = mix.seed || {};
  return `<div class="page mix-page" data-mix-root data-mix-id="${esc(id)}">
    <div class="page-head">
      <a class="icon-btn" href="/feed/mixes" data-link aria-label="Back to mixes">${icon('arrow-left')}</a>
      <h1>${icon('shuffle')} Mix</h1>
      <span class="spacer"></span>
    </div>
    <div class="mix-hero">
      <img class="mix-cover" src="${esc(seed.thumb || (tracks[0] && tracks[0].thumb) || '')}" alt="" width="320" height="180">
      <div class="mix-hero-text">
        <span class="mix-kicker">${icon('spark')} Auto-generated mix</span>
        <h2>Based on ${esc(seed.title || 'your music')}</h2>
        <p class="mix-meta">${tracks.length} similar songs · from ${esc(seed.channel || 'YouTube')}</p>
        <div class="mix-actions">
          <button type="button" class="btn-primary" data-mix-play ${tracks.length ? '' : 'disabled'}>${icon('play')} Play all</button>
          <button type="button" class="btn-outline" data-mix-shuffle ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Shuffle</button>
          <button type="button" class="btn-outline" data-mix-refresh>${icon('refresh')} Refresh</button>
        </div>
      </div>
    </div>
    <div class="mix-list" data-mix-list>${tracks.length
      ? tracks.map(mixTrackHtml).join('')
      : '<p class="related-empty">No tracks yet. Tap Refresh to rebuild this mix.</p>'}</div>
  </div>`;
}

export function mountMix(root, id) {
  if (!store.mixById(id)) return;

  const paint = () => {
    const current = store.mixById(id);
    if (!current) return;
    const list = root.querySelector('[data-mix-list]');
    if (list) {
      list.innerHTML = (current.tracks || []).length
        ? current.tracks.map(mixTrackHtml).join('')
        : '<p class="related-empty">No tracks yet. Tap Refresh to rebuild this mix.</p>';
    }
    const meta = root.querySelector('.mix-meta');
    if (meta) meta.textContent = `${(current.tracks || []).length} similar songs · from ${current.seed?.channel || 'YouTube'}`;
  };

  const play = (shuffle) => {
    const tracks = [...(store.mixById(id)?.tracks || [])];
    if (!tracks.length) return;
    if (shuffle) tracks.sort(() => Math.random() - 0.5);
    const [first, ...rest] = tracks;
    store.clearQueue();
    store.addManyToQueue(rest, 'mix:' + id);
    navigate(`/watch/yt/${encodeURIComponent(first.id)}?autoplay=1`);
  };

  root.querySelector('[data-mix-play]')?.addEventListener('click', () => play(false));
  root.querySelector('[data-mix-shuffle]')?.addEventListener('click', () => play(true));
  root.querySelector('[data-mix-refresh]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const seed = store.mixById(id)?.seed;
      const tracks = await buildMix(seed, searchYouTube, { count: 20, topic: '' });
      store.saveMix({ id, seed, tracks });
      paint();
      toast(`Refreshed ${tracks.length} songs`);
    } catch {
      toast('Could not refresh this mix.');
    } finally {
      button.disabled = false;
    }
  });

  root.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-queue]');
    if (!add) return;
    const added = store.addToQueue({
      id: add.dataset.addQueue,
      title: add.dataset.qTitle,
      channel: add.dataset.qChannel,
      thumb: add.dataset.qThumb,
      length: add.dataset.qLength,
    });
    toast(added ? 'Added to Up Next' : 'Already in Up Next');
  });
}

export function renderMixes() {
  const mixes = store.recentMixes();
  return `<div class="page mixes-page">
    <div class="page-head">
      <h1>${icon('shuffle')} Music mixes</h1>
      <span class="spacer"></span>
      ${mixes.length ? '<button type="button" class="btn-outline" data-mixes-clear>Clear all</button>' : ''}
    </div>
    <p class="mixes-intro">Mixes are built from a song you played — similar tracks, no repeated titles.</p>
    ${mixes.length
      ? `<div class="mixes-grid">${mixes.map((m) => `<a class="mix-card" href="/mix/${encodeURIComponent(m.id)}" data-link>
          <span class="mix-card-cover"><img src="${esc(m.seed?.thumb || '')}" alt="" loading="lazy" width="320" height="180"></span>
          <span class="mix-card-title">Mix</span>
          <span class="mix-card-sub">Based on ${esc(m.seed?.title || 'your music')}</span>
          <span class="mix-card-count">${(m.tracks || []).length} songs</span>
        </a>`).join('')}</div>`
      : emptyState({
          iconName: 'music',
          title: 'No mixes yet',
          text: 'Open a song, tap Mix, and dinosour will build a queue of similar music.',
          actionHref: '/',
          actionText: 'Browse home',
        })}
  </div>`;
}

export function mountMixes(root) {
  root.querySelector('[data-mixes-clear]')?.addEventListener('click', () => {
    store.clearMixes();
    root.innerHTML = renderMixes();
    mountMixes(root);
    toast('Mixes cleared');
  });
}
