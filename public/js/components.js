/* Reusable pieces of markup. */

import { store } from './store.js';
import { esc, compact, fmtDuration, timeAgo, avatarStyle, initials } from './util.js';

export function verifiedIcon(cls = '') {
  return `<svg class="verified ${cls}" viewBox="0 0 24 24" aria-label="Verified" role="img"><path fill="currentColor" d="M12 2.2l2.5 2.1 3.3-.4 1 3.1 2.9 1.7-1 3.1 1 3.1-2.9 1.7-1 3.1-3.3-.4L12 21.8l-2.5-2.2-3.3.4-1-3.1-2.9-1.7 1-3.1-1-3.1 2.9-1.7 1-3.1 3.3.4z"/><path d="m8.6 12.2 2.2 2.2 4.6-4.7" fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function avatar(ch, extraClass = '', tag = 'span') {
  return `<${tag} class="avatar ${extraClass}" style="${avatarStyle(ch.color)}" aria-hidden="true">${esc(initials(ch.name))}</${tag}>`;
}

function progressHtml(v, thin = false) {
  const p = store.getProgress(v.id);
  if (!p) return '';
  return `<span class="watched-bar"><i style="width:${p.pct.toFixed(2)}%"></i></span>`;
}

export function cardHtml(v) {
  const ch = v.channelData;
  return `<article class="card" data-id="${v.id}" data-src="${esc(v.src)}">
  <a class="card-thumb-link" href="/watch/${v.id}" data-link aria-hidden="true" tabindex="-1">
    <div class="thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="640" height="360">
      <span class="duration">${fmtDuration(v.duration)}</span>
      ${progressHtml(v)}
    </div>
  </a>
  <button class="card-menu" data-menu="card" data-id="${v.id}" aria-label="More actions">${iconDots()}</button>
  <div class="card-details">
    <a href="/channel/${ch.id}" data-link class="avatar-link" aria-hidden="true" tabindex="-1">${avatar(ch)}</a>
    <div class="card-text">
      <a href="/watch/${v.id}" data-link><h3 class="card-title">${esc(v.title)}</h3></a>
      <a class="card-channel" href="/channel/${ch.id}" data-link>
        <span class="name">${esc(ch.name)}</span>${ch.verified ? verifiedIcon() : ''}
      </a>
      <div class="card-meta">${compact(v.views)} views &middot; ${timeAgo(v.published)}</div>
    </div>
  </div>
</article>`;
}

function iconDots() {
  return `<svg class="icon" aria-hidden="true"><use href="#i-dots"></use></svg>`;
}

export function shortCardHtml(v) {
  const ch = v.channelData;
  return `<article class="short-card" data-id="${v.id}">
  <a href="/watch/${v.id}" data-link>
    <div class="short-thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="480" height="270">
      <span class="short-views">${compact(v.views)} views</span>
    </div>
    <h3 class="short-title">${esc(v.title)}</h3>
    <div class="short-sub">${esc(ch.name)}</div>
  </a>
</article>`;
}

export function relItemHtml(v) {
  const ch = v.channelData;
  return `<a class="rel-item" href="/watch/${v.id}" data-link>
  <div class="rel-thumb">
    <img src="${esc(v.thumb)}" alt="" loading="lazy" width="320" height="180">
    <span class="duration">${fmtDuration(v.duration)}</span>
    ${progressHtml(v, true)}
  </div>
  <div class="rel-text">
    <div class="rel-title">${esc(v.title)}</div>
    <div class="rel-channel">${esc(ch.name)}</div>
    <div class="rel-meta">${compact(v.views)} views &middot; ${timeAgo(v.published)}</div>
  </div>
</a>`;
}

export function emptyState({ iconName = 'film', title, text, actionHref, actionText }) {
  return `<div class="empty">
    <div class="empty-icon"><svg class="icon"><use href="#i-${iconName}"></use></svg></div>
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    ${actionHref ? `<a class="btn-primary" href="${actionHref}" data-link>${esc(actionText)}</a>` : ''}
  </div>`;
}

export function skeletonGrid(count = 8) {
  return `<div class="skeleton-grid" aria-hidden="true">${Array.from({ length: count })
    .map(
      () => `<div class="skel-wrap"><div class="skel skel-thumb"></div>
      <div style="display:flex;gap:12px;margin-top:12px">
        <div class="skel" style="width:36px;height:36px;border-radius:50%"></div>
        <div style="flex:1"><div class="skel skel-line" style="width:92%"></div><div class="skel skel-line" style="width:50%"></div></div>
      </div></div>`
    )
    .join('')}</div>`;
}
