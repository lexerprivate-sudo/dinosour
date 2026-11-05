/* Page rendering. Each render* returns HTML; mount* wires behavior. */

import { Player } from './player.js';
import { store } from './store.js';
import {
  channelById,
  channelVideos,
  commentsFor,
  longVideos,
  relatedFor,
  searchChannels,
  searchVideos,
  shortVideos,
  videoById,
} from './data.js';
import {
  avatar,
  cardHtml,
  emptyState,
  relItemHtml,
  shortCardHtml,
  verifiedIcon,
} from './components.js';
import { avatarStyle, compact, esc, exact, fmtDuration, initials, shade, timeAgo, APP_MODE } from './util.js';
import { navigate, openMenu, toast } from './ui.js';
import { searchYouTube, videoInfo } from './yt.js';

const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

/* ============================================================ home */

/* Topic chips: All, the user's own topics, and a button to add more. */
export function renderChips(active = 'All') {
  const topics = store.customTopics();
  const list = ['All', ...topics];
  return `<div class="chips-wrap"><div class="chips" role="tablist" aria-label="Topics">${list
    .map(
      (c) =>
        `<button type="button" class="chip ${c === active ? 'active' : ''}" data-chip="${esc(c)}" role="tab" aria-selected="${c === active}">${esc(c)}</button>`
    )
    .join('')}<button type="button" class="chip chip-add" data-topic-add aria-label="Add a topic" title="Add a topic">${icon(
    'plus'
  )}<span>Add topic</span></button></div></div>`;
}

export function renderHome({ topic = 'All' } = {}) {
  const isTopic = topic && topic !== 'All';
  const showLocal = !APP_MODE && !isTopic;
  const list = showLocal ? longVideos() : [];
  const shorts = showLocal ? shortVideos() : [];

  if (showLocal && !list.length) {
    return `${renderChips(topic)}${emptyState({
      iconName: 'film',
      title: 'Nothing here yet',
      text: 'There are no videos in the library right now.',
      actionHref: '/',
      actionText: 'Back to home',
    })}`;
  }

  const head = list.slice(0, 8);
  const tail = list.slice(8);

  return `${renderChips(topic)}
  ${!isTopic ? resumeRailHtml() : ''}
  ${
    isTopic
      ? `<section class="topic-banner">
          <div class="topic-banner-glow" aria-hidden="true"></div>
          <div class="topic-banner-inner">
            <span class="topic-eyebrow">${icon('spark')} Your topic</span>
            <h1>${esc(topic)}</h1>
            <p>An endless stream of YouTube videos about ${esc(topic)}.</p>
            <button type="button" class="topic-banner-edit" data-topic-add>${icon('plus')} Edit topics</button>
          </div>
        </section>`
      : ''
  }
  ${head.length ? `<div class="grid">${head.map(cardHtml).join('')}</div>` : ''}
  ${!isTopic && shorts.length ? shortsSection(shorts) : ''}
  ${tail.length ? `<div class="grid">${tail.map(cardHtml).join('')}</div>` : ''}
  <div class="grid" data-home-more-grid></div>
  <div class="feed-loader" data-home-more hidden><span class="spinner"></span></div>
  <div class="feed-end" data-home-end hidden>
    <button type="button" class="btn-more" data-home-retry>Try again</button>
  </div>
  <div class="feed-sentinel" data-home-sentinel aria-hidden="true"></div>`;
}

/* Continue watching: a rail of in-progress YouTube videos. */
function resumeCardHtml(r) {
  const pct = Math.min(100, Math.max(2, (r.t / r.d) * 100));
  const left = Math.max(0, Math.floor(r.d - r.t));
  return `<a class="resume-card" href="/watch/yt/${encodeURIComponent(r.id)}" data-link>
    <div class="resume-thumb">
      <img src="${esc(r.thumb)}" alt="" loading="lazy">
      <span class="resume-left">${fmtDuration(left)} left</span>
      <span class="resume-bar" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></span>
    </div>
    <div class="resume-title">${esc(r.title)}</div>
    <div class="resume-channel">${esc(r.channel || 'YouTube')}</div>
  </a>`;
}

function resumeRailHtml() {
  const items = store.resumeList().slice(0, 10);
  if (!items.length) return '';
  return `<section class="resume-rail" aria-label="Continue watching">
    <div class="resume-head">
      <h2>${icon('history')} Continue watching</h2>
      <button type="button" class="text-btn" data-clear-resume>Clear</button>
    </div>
    <div class="resume-track">${items.map(resumeCardHtml).join('')}</div>
  </section>`;
}

/* The mix behind "All". Invisible to users; it just keeps the feed varied. */
const DEFAULT_SEEDS = [
  'lofi music',
  'space documentary',
  '4k nature',
  'travel film',
  'live music',
  'technology',
  'food',
  'animated short film',
];

const TRENDING_SEEDS = ['trending now', 'popular videos', 'viral videos', 'top music', 'new trailers'];

/** Infinite home feed: the library for "All" (web), then live YouTube results. */
export async function mountHome(root, topic = 'All') {
  return mountFeed(root, topic && topic !== 'All' ? [topic] : DEFAULT_SEEDS);
}

/** The app's Trending tab: an endless feed of popular YouTube results. */
export async function mountTrending(root) {
  return mountFeed(root, TRENDING_SEEDS);
}

async function mountFeed(root, seeds) {
  const grid = root.querySelector('[data-home-more-grid]');
  const loader = root.querySelector('[data-home-more]');
  const sentinel = root.querySelector('[data-home-sentinel]');
  const end = root.querySelector('[data-home-end]');
  const retry = root.querySelector('[data-home-retry]');
  if (!grid || !loader || !sentinel) return;

  const seen = new Set();
  for (const card of root.querySelectorAll('.grid .card[data-id]')) seen.add(card.dataset.id);

  let cursor = 0;
  const tokens = new Map();
  let busy = false;
  let failed = false;
  const alive = () => sentinel.isConnected;

  const paint = () => {
    loader.hidden = !busy;
    end.hidden = !failed;
  };

  const load = async () => {
    if (busy || !alive()) return;
    busy = true;
    failed = false;
    paint();

    let added = 0;
    let attempts = 0;
    try {
      while (alive() && !added && attempts++ < 12) {
        // Rotate through the seeds so the feed never turns into one topic.
        const seed = seeds[cursor++ % seeds.length];
        const token = tokens.get(seed) || '';
        const data = token
          ? await searchYouTube('', { continuation: token })
          : await searchYouTube(seed);
        if (!alive()) return;

        tokens.set(seed, data.continuation || null);
        const fresh = (data.videos || []).filter((v) => v && v.id && !seen.has(v.id));
        for (const v of fresh) seen.add(v.id);
        if (fresh.length) {
          grid.insertAdjacentHTML('beforeend', fresh.map(ytCardHtml).join(''));
          added = fresh.length;
        }
      }
    } catch {
      if (!alive()) return;
      failed = true;
    } finally {
      busy = false;
      if (alive()) {
        paint();
        if (added) maybeMore();
      }
    }
  };

  const maybeMore = () => {
    if (busy || failed || !sentinel.isConnected) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 900) load();
  };

  retry?.addEventListener('click', () => {
    failed = false;
    paint();
    load();
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (failed) return;
      load();
    },
    { rootMargin: '900px 0px' }
  );
  observer.observe(sentinel);

  const onScroll = () => maybeMore();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  root.__feedCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    observer.disconnect();
  };

  paint();
  maybeMore();
}

function shortsSection(shorts) {
  return `<section class="shorts">
    <div class="section-head shorts-head">
      ${icon('shorts')}
      <h2>Shorts</h2>
      <span class="spacer"></span>
      <span class="short-hint">${shorts.length} quick clips</span>
    </div>
    <div class="shorts-track">${shorts.map(shortCardHtml).join('')}</div>
  </section>`;
}

/* ============================================================ watch */

export function renderWatch(video, next) {
  const ch = video.channelData;
  const liked = store.isLiked(video.id);
  const disliked = store.isDisliked(video.id);
  const saved = store.isSaved(video.id);
  const likeCount = video.likes + (liked ? 1 : 0);

  const seen = new Set([video.id, next?.id]);
  const related = [next, ...relatedFor(video, 18).filter((v) => !seen.has(v.id))].filter(Boolean).slice(0, 14);

  return `<div class="watch">
    <div class="watch-main">
      <div class="player" id="player" tabindex="-1"></div>

      <h1 class="watch-title">${esc(video.title)}</h1>

      <div class="watch-meta-row">
        <div class="watch-views">${exact(video.views)} views <span class="dim">·</span> ${timeAgo(video.published)}</div>
        <div class="watch-actions">
          <div class="action-group">
            <button class="action-btn ${liked ? 'liked' : ''}" data-like aria-pressed="${liked}" aria-label="Like">
              ${icon('thumb-up')}<span class="action-count" data-like-count>${compact(likeCount)}</span>
            </button>
            <span class="divider"></span>
            <button class="action-btn ${disliked ? 'disliked' : ''}" data-dislike aria-pressed="${disliked}" aria-label="Dislike">
              ${icon('thumb-down')}
            </button>
          </div>
          <button class="action-btn" data-share>${icon('share')} Share</button>
          <button class="action-btn ${saved ? 'active' : ''}" data-save>
            ${icon(saved ? 'check' : 'save')} <span data-save-label>${saved ? 'Saved' : 'Save'}</span>
          </button>
          <button class="action-btn" data-more aria-label="More actions">${icon('dots-h')}</button>
        </div>
      </div>

      <div class="channel-row">
        <a href="/channel/${ch.id}" data-link aria-label="${esc(ch.name)}">${avatar(ch, 'lg')}</a>
        <div class="channel-info">
          <a href="/channel/${ch.id}" data-link><div class="channel-name">${esc(ch.name)} ${ch.verified ? verifiedIcon() : ''}</div></a>
          <div class="channel-sub">${compact(ch.videoCount)} videos &middot; ${compact(ch.totalViews)} views</div>
        </div>
        <a class="action-btn" href="/channel/${ch.id}" data-link>View channel</a>
        <button class="icon-btn" data-channel-menu aria-label="Channel options">${icon('dots')}</button>
      </div>

      <div class="desc" data-desc>
        <div class="desc-text">${esc(video.description)}</div>
        <div class="desc-tags">${(video.tags || []).map((t) => `<a href="/results?search_query=${encodeURIComponent(t)}" data-link>#${esc(t)}</a>`).join(' ')}</div>
        <span class="desc-toggle" data-desc-toggle>Show more</span>
      </div>

      <section class="comments" data-comments>${commentsSectionHtml(video)}</section>
    </div>

    <aside class="related" aria-label="Up next">
      <div class="related-head">
        <h2>Up next</h2>
        <button class="autoplay-toggle" data-autoplay aria-pressed="${store.state.autoplay}">
          <span class="switch ${store.state.autoplay ? 'on' : ''}"></span>Autoplay
        </button>
      </div>
      ${related.length ? related.map(relItemHtml).join('') : '<p class="related-empty">No more videos in the library.</p>'}
    </aside>
  </div>`;
}

export function mountWatch(root, video, next) {
  const playerEl = root.querySelector('#player');
  const player = new Player(playerEl, video, {
    next,
    onNavigate: (path) => navigate(path),
    onToast: (msg) => toast(msg),
    onResume: (saved) =>
      toast(`Resumed at ${fmtDuration(saved.t)}`, {
        action: 'Start over',
        onAction: () => {
          player.media.currentTime = 0;
          player.saveProgress();
          player.reveal(true);
        },
      }),
  });

  const likeBtn = root.querySelector('[data-like]');
  const dislikeBtn = root.querySelector('[data-dislike]');
  const likeCountEl = root.querySelector('[data-like-count]');
  const baseLikes = video.likes;

  const refreshReactions = () => {
    const liked = store.isLiked(video.id);
    const disliked = store.isDisliked(video.id);
    likeBtn.classList.toggle('liked', liked);
    likeBtn.setAttribute('aria-pressed', String(liked));
    dislikeBtn.classList.toggle('disliked', disliked);
    dislikeBtn.setAttribute('aria-pressed', String(disliked));
    likeCountEl.textContent = compact(baseLikes + (liked ? 1 : 0));
  };

  likeBtn.addEventListener('click', () => {
    store.toggleLike(video.id);
    refreshReactions();
  });
  dislikeBtn.addEventListener('click', () => {
    store.toggleDislike(video.id);
    refreshReactions();
  });

  root.querySelector('[data-share]').addEventListener('click', () => copyLink());
  root.querySelector('[data-save]').addEventListener('click', (e) => {
    const saved = store.toggleSave(video.id);
    const btn = e.currentTarget;
    btn.classList.toggle('active', saved);
    btn.innerHTML = `${icon(saved ? 'check' : 'save')} <span data-save-label>${saved ? 'Saved' : 'Save'}</span>`;
    toast(saved ? 'Saved to Watch later' : 'Removed from Watch later');
  });

  root.querySelector('[data-more]').addEventListener('click', (e) => {
    const saved = store.isSaved(video.id);
    openMenu(e.currentTarget, [
      { key: 'save', icon: saved ? 'check' : 'save', label: saved ? 'Remove from Watch later' : 'Save to Watch later', onClick: () => {
        const now = store.toggleSave(video.id);
        const btn = root.querySelector('[data-save]');
        btn.classList.toggle('active', now);
        btn.innerHTML = `${icon(now ? 'check' : 'save')} <span data-save-label>${now ? 'Saved' : 'Save'}</span>`;
        toast(now ? 'Saved to Watch later' : 'Removed from Watch later');
      } },
      ...(/\.m3u8(\?|$)/i.test(video.src)
        ? []
        : [{ key: 'download', icon: 'download', label: 'Download', onClick: () => downloadVideo(video) }]),
      { key: 'copy', icon: 'link', label: 'Copy link', onClick: () => copyLink() },
      { sep: true },
      { key: 'channel', icon: 'film', label: 'View channel', onClick: () => navigate(`/channel/${video.channel}`) },
    ]);
  });

  root.querySelector('[data-channel-menu]').addEventListener('click', (e) => {
    openMenu(e.currentTarget, [
      { key: 'open', icon: 'film', label: 'View channel', onClick: () => navigate(`/channel/${video.channel}`) },
      { key: 'copy', icon: 'link', label: 'Copy channel link', onClick: () => copyLink(`${location.origin}/channel/${video.channel}`, 'Channel link copied') },
    ]);
  });

  root.querySelector('[data-autoplay]').addEventListener('click', (e) => {
    const on = !store.state.autoplay;
    store.set('autoplay', on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.querySelector('.switch').classList.toggle('on', on);
    toast(on ? 'Autoplay on' : 'Autoplay off');
  });

  const desc = root.querySelector('[data-desc]');
  desc.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const open = desc.classList.toggle('expanded');
    desc.querySelector('[data-desc-toggle]').textContent = open ? 'Show less' : 'Show more';
  });

  mountComments(root.querySelector('[data-comments]'), video);

  return {
    player,
    destroy() {
      player.destroy();
    },
  };
}

function downloadVideo(video) {
  const a = document.createElement('a');
  a.href = video.src;
  a.download = `${video.id}.mp4`;
  document.body.append(a);
  a.click();
  a.remove();
  toast('Download started');
}

function copyLink(url = location.href, message = 'Link copied to clipboard') {
  const done = () => toast(message);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
  } else {
    fallbackCopy(url, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
  done();
}

/* comments */

const AVATAR_COLORS = ['#e11d48', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#db2777', '#2563eb', '#0d9488'];

function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function commentsSectionHtml(video) {
  const local = store.localComments(video.id);
  const total = (video.commentCount || 0) + local.length;
  return `<div class="comments-head">
      <h3><span data-comment-count>${exact(total)}</span> Comments</h3>
      <button class="sort-btn" data-sort>${icon('sort')}<span data-sort-label>Top comments</span></button>
    </div>
    <form class="comment-form" data-comment-form>
      <span class="avatar" style="background:linear-gradient(140deg,#2563eb,#1e3a8a)">Y</span>
      <div class="comment-input-wrap">
        <textarea class="comment-input" rows="1" placeholder="Add a comment..." data-comment-input aria-label="Add a comment"></textarea>
        <div class="comment-form-actions">
          <button type="button" class="btn-text" data-comment-cancel hidden>Cancel</button>
          <button type="submit" class="btn-text primary" data-comment-submit disabled>Comment</button>
        </div>
      </div>
    </form>
    <div data-comment-list></div>`;
}

function commentHtml(videoId, c) {
  const key = `${videoId}:${c.id}`;
  const liked = store.isCommentLiked(key);
  const likes = (c.likes || 0) + (liked ? 1 : 0);
  const when = c.local ? timeAgo(new Date(c.at).toISOString()) : c.when || '';
  const color = c.local ? '#2563eb' : colorFor(c.author);
  return `<article class="comment" data-comment="${esc(c.id)}">
    <span class="avatar" style="${avatarStyle(color)}">${esc(initials(c.author))}</span>
    <div class="comment-body">
      <div class="comment-line">
        <span class="comment-author">${c.local ? '@you' : esc(c.author)}</span>
        <span class="comment-when">${esc(when)}</span>
      </div>
      <div class="comment-text">${esc(c.text)}</div>
      <div class="comment-tools">
        <button data-comment-like="${esc(key)}" data-base="${c.likes || 0}" class="${liked ? 'liked' : ''}" aria-label="Like comment">
          ${icon('thumb-up')}<span>${likes || ''}</span>
        </button>
        <button data-reply="${esc(c.author)}">Reply</button>
        ${c.local ? `<button data-delete="${esc(c.id)}" aria-label="Delete comment">${icon('trash')}</button>` : ''}
      </div>
    </div>
  </article>`;
}

function mountComments(root, video) {
  const listEl = root.querySelector('[data-comment-list]');
  const form = root.querySelector('[data-comment-form]');
  const input = root.querySelector('[data-comment-input]');
  const submit = root.querySelector('[data-comment-submit]');
  const cancel = root.querySelector('[data-comment-cancel]');
  const sortBtn = root.querySelector('[data-sort]');
  const sortLabel = root.querySelector('[data-sort-label]');
  const countEl = root.querySelector('[data-comment-count]');
  let sort = 'top';

  const render = () => {
    const seeded = [...commentsFor(video.id)];
    if (sort === 'top') seeded.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else seeded.reverse();
    const local = store.localComments(video.id);
    const all = [...local, ...seeded];
    listEl.innerHTML = all.length
      ? all.map((c) => commentHtml(video.id, c)).join('')
      : '<p class="related-empty">No comments yet. Start the conversation.</p>';
    countEl.textContent = exact((video.commentCount || 0) + local.length);
  };

  render();

  sortBtn.addEventListener('click', () => {
    sort = sort === 'top' ? 'new' : 'top';
    sortLabel.textContent = sort === 'top' ? 'Top comments' : 'Newest first';
    render();
  });

  input.addEventListener('input', () => {
    submit.disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    cancel.hidden = !input.value.length;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  cancel.addEventListener('click', () => {
    input.value = '';
    input.style.height = 'auto';
    submit.disabled = true;
    cancel.hidden = true;
    input.blur();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    store.addComment(video.id, text);
    input.value = '';
    input.style.height = 'auto';
    submit.disabled = true;
    cancel.hidden = true;
    render();
    toast('Comment added');
  });

  listEl.addEventListener('click', (e) => {
    const like = e.target.closest('[data-comment-like]');
    if (like) {
      const key = like.dataset.commentLike;
      const liked = store.toggleCommentLike(key);
      const base = Number(like.dataset.base || 0);
      like.classList.toggle('liked', liked);
      like.querySelector('span').textContent = String(base + (liked ? 1 : 0) || '');
      return;
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
      store.deleteComment(video.id, del.dataset.delete);
      render();
      toast('Comment deleted');
      return;
    }
    const reply = e.target.closest('[data-reply]');
    if (reply) {
      input.value = `@${reply.dataset.reply} `;
      input.focus();
      input.dispatchEvent(new Event('input'));
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

/* ============================================================ results */

function skeletons(count = 5) {
  return Array.from({ length: count })
    .map(
      () => `<div class="result yt-skeleton" aria-hidden="true">
        <div class="thumb skel"></div>
        <div class="result-info">
          <div class="skel skel-line" style="width:88%;height:16px"></div>
          <div class="skel skel-line" style="width:42%"></div>
          <div class="skel skel-line" style="width:64%"></div>
        </div>
      </div>`
    )
    .join('');
}

export function renderResults(query) {
  const q = (query || '').trim();
  if (!q) {
    return `<div class="results">${emptyState({
      iconName: 'search',
      title: 'Search',
      text: APP_MODE ? 'Search YouTube.' : 'Search YouTube or this site.',
      actionHref: '/',
      actionText: 'Browse home',
    })}</div>`;
  }

  const local = APP_MODE ? [] : searchVideos(q);
  const chans = APP_MODE ? [] : searchChannels(q);

  const chanStrip = chans.length
    ? `<div class="channel-strip">${chans
        .map(
          (c) => `<a class="channel-chip" href="/channel/${c.id}" data-link>
            ${avatar(c, 'lg')}
            <div><div class="cc-name">${esc(c.name)} ${c.verified ? verifiedIcon() : ''}</div>
            <div class="cc-sub">${compact(c.videoCount)} videos &middot; ${compact(c.totalViews)} views</div></div>
          </a>`
        )
        .join('')}</div>`
    : '';

  const localBlock = local.length
    ? `<section class="local-hits" data-local-hits>
        <div class="section-label">From this site</div>
        ${local.map(resultItemHtml).join('')}
      </section>`
    : '';

  return `<div class="results" data-results>
    ${chanStrip}
    <div class="results-head">
      <h1>Results for <span>“${esc(q)}”</span></h1>
      <p class="results-sub" data-results-sub>${local.length ? `${local.length} from this site` : ''}</p>
    </div>

    ${localBlock}

    <section class="yt-block" data-yt-results aria-label="YouTube results">
      <div class="yt-block-head">
        <h2>YouTube</h2>
      </div>
      <div class="yt-list" data-yt-list>${skeletons(5)}</div>
      <p class="yt-status" data-yt-status role="status" aria-live="polite" hidden></p>
      <button type="button" class="btn-more" data-yt-more hidden>Show more results</button>
      <div class="feed-loader" data-yt-loader hidden><span class="spinner"></span></div>
      <div class="feed-sentinel" data-yt-sentinel aria-hidden="true"></div>
    </section>
  </div>`;
}

export async function mountResults(root, query) {
  const list = root.querySelector('[data-yt-list]');
  const more = root.querySelector('[data-yt-more]');
  const status = root.querySelector('[data-yt-status]');
  const sub = root.querySelector('[data-results-sub]');
  const loader = root.querySelector('[data-yt-loader]');
  const sentinel = root.querySelector('[data-yt-sentinel]');
  if (!list || !more || !status) return;

  const localCount = APP_MODE ? 0 : searchVideos(query).length;
  let continuation = null;
  let loaded = 0;
  let busy = false;
  const alive = () => list.isConnected;

  const paintCount = () => {
    const parts = [];
    if (localCount) parts.push(`${localCount} from this site`);
    if (loaded) parts.push(`${loaded} from YouTube`);
    sub.textContent = parts.join(' · ');
  };

  const setStatus = (message) => {
    status.textContent = message || '';
    status.hidden = !message;
  };

  const load = async (nextPage = false) => {
    if (busy) return;
    if (nextPage && !continuation) return;
    busy = true;
    more.disabled = true;
    if (loader) loader.hidden = false;
    setStatus('');
    if (!nextPage) list.innerHTML = skeletons(5);

    try {
      const data = await searchYouTube(nextPage ? '' : query, {
        continuation: nextPage ? continuation : '',
      });
      if (!alive()) return;

      const videos = Array.isArray(data.videos) ? data.videos : [];
      loaded += videos.length;
      const html = videos.map(ytResultItemHtml).join('');

      if (nextPage) list.insertAdjacentHTML('beforeend', html);
      else list.innerHTML = html;

      continuation = data.continuation || null;
      more.hidden = true;
      more.textContent = 'Show more results';
      delete more.dataset.retry;
      paintCount();

      if (!loaded) {
        setStatus(`No results for “${query}”.`);
      }
    } catch {
      if (!alive()) return;
      if (!nextPage) list.innerHTML = '';
      setStatus('Couldn’t load YouTube results.');
      more.hidden = false;
      more.textContent = 'Try again';
      more.dataset.retry = nextPage ? '1' : '0';
    } finally {
      busy = false;
      if (alive()) {
        more.disabled = false;
        if (loader) loader.hidden = true;
        maybeMore();
      }
    }
  };

  const maybeMore = () => {
    if (busy || !continuation || !sentinel || !alive()) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 900) load(true);
  };

  more.addEventListener('click', () => {
    if (more.dataset.retry !== undefined) {
      const retryNext = more.dataset.retry === '1';
      delete more.dataset.retry;
      load(retryNext);
    } else {
      load(true);
    }
  });

  if (sentinel) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && more.hidden) load(true);
      },
      { rootMargin: '900px 0px' }
    );
    observer.observe(sentinel);
  }

  const onScroll = () => maybeMore();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  root.__feedCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };

  await load(false);
}

function ytCardHtml(v) {
  const channel = v.channel || 'YouTube';
  const meta = [v.viewsText, v.publishedText].filter(Boolean).join(' · ');
  return `<article class="card yt-card">
  <a class="card-thumb-link" href="/watch/yt/${encodeURIComponent(v.id)}" data-link aria-hidden="true" tabindex="-1">
    <div class="thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="640" height="360">
      ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
    </div>
  </a>
  <div class="card-details">
    ${avatar({ name: channel, color: colorFor(channel) })}
    <div class="card-text">
      <a href="/watch/yt/${encodeURIComponent(v.id)}" data-link><h3 class="card-title">${esc(v.title)}</h3></a>
      <div class="card-channel"><span class="name">${esc(channel)}</span></div>
      ${meta ? `<div class="card-meta">${esc(meta)}</div>` : ''}
    </div>
  </div>
</article>`;
}

function ytResultItemHtml(v) {
  const desc = (v.description || '').replace(/\s+/g, ' ').slice(0, 190);
  const meta = [v.viewsText, v.publishedText].filter(Boolean).join(' · ');
  return `<a class="result yt-result" href="/watch/yt/${encodeURIComponent(v.id)}" data-link>
    <div class="thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="480" height="360">
      ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
    </div>
    <div class="result-info">
      <h3 class="result-title">${esc(v.title)}</h3>
      <div class="result-meta">${esc(meta || 'YouTube')}</div>
      <div class="result-channel">${avatar({ name: v.channel, color: colorFor(v.channel) })}<span>${esc(v.channel)}</span></div>
      ${desc ? `<div class="result-desc">${esc(desc)}</div>` : ''}
    </div>
  </a>`;
}

function queueAttrs(v) {
  return `data-add-queue="${esc(v.id)}" data-q-title="${esc(v.title)}" data-q-channel="${esc(
    v.channel || 'YouTube'
  )}" data-q-thumb="${esc(v.thumb)}" data-q-length="${esc(v.length || '')}"`;
}

function queueItemHtml(v) {
  return `<div class="queue-item">
    <a class="queue-link" href="/watch/yt/${encodeURIComponent(v.id)}" data-link>
      <span class="queue-thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" width="168" height="94">
        ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
      </span>
      <span class="queue-text">
        <span class="queue-title">${esc(v.title)}</span>
        <span class="queue-channel">${esc(v.channel || 'YouTube')}</span>
      </span>
    </a>
    <button class="queue-remove" type="button" data-queue-remove="${esc(v.id)}" aria-label="Remove from Up Next" title="Remove from Up Next">${icon('x')}</button>
  </div>`;
}

function ytEndItemHtml(v) {
  return `<a class="end-related-item" href="/watch/yt/${encodeURIComponent(v.id)}?autoplay=1" data-link>
    <span class="end-related-thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy" width="160" height="90"></span>
    <span class="end-related-title">${esc(v.title)}</span>
  </a>`;
}

function ytRelItemHtml(v) {
  return `<div class="rel-row">
    <a class="rel-item" href="/watch/yt/${encodeURIComponent(v.id)}" data-link>
      <div class="rel-thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" width="320" height="180">
        ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
      </div>
      <div class="rel-text">
        <div class="rel-title">${esc(v.title)}</div>
        <div class="rel-channel">${esc(v.channel)}</div>
        <div class="rel-meta">${esc([v.viewsText, v.publishedText].filter(Boolean).join(' · '))}</div>
      </div>
    </a>
    <button class="rel-add" type="button" ${queueAttrs(v)} aria-label="Add to Up Next" title="Add to Up Next">${icon('plus')}</button>
  </div>`;
}

/* ==================================================== YouTube watch */

function remoteMeta(info) {
  if (!info) return '';
  const published = info.published ? timeAgo(info.published) : info.publishedText;
  return [info.viewsText, published].filter(Boolean).join(' · ');
}

const YT_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const YT_QUALITIES = [
  ['auto', 'Auto'],
  ['hd1080', '1080p'],
  ['hd720', '720p'],
  ['large', '480p'],
  ['medium', '360p'],
];
const YT_QUALITY_NAMES = {
  highres: '4K',
  hd2160: '4K',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
};

export function renderRemoteWatch(id, info = null) {
  const title = info?.title || 'YouTube video';
  const meta = remoteMeta(info);
  const saved = store.resumeFor(id);
  const pct = saved ? Math.min(100, Math.max(1, (saved.t / saved.d) * 100)) : 0;
  const rate = YT_RATES.includes(Number(store.state.ytRate)) ? Number(store.state.ytRate) : 1;
  const quality = YT_QUALITIES.find(([value]) => value === store.state.ytQuality)?.[1] || 'Auto';

  const queue = store.queueList();
  const autoplay = !!store.state.autoplay;

  return `<div class="watch yt-watch">
    <div class="watch-main">
      <div class="player yt-player" data-yt-player data-id="${encodeURIComponent(id)}">
        <img class="yt-poster" src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg" alt="" width="480" height="360">
        ${
          saved
            ? `<div class="yt-resume-hint">
                <span class="yt-resume-badge">${icon('history')} Resume at ${fmtDuration(saved.t)}</span>
                <span class="yt-resume-bar" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></span>
              </div>`
            : ''
        }
        <button class="yt-play" type="button" data-yt-play aria-label="${saved ? 'Resume video' : 'Play video'}">
          <span class="yt-play-btn">${icon('play')}</span>
          ${saved ? '<span class="yt-play-label">Resume</span>' : ''}
        </button>

        <div class="end-card yt-end" data-yt-end aria-live="polite">
          <div class="end-main">
            <div class="end-label" data-end-label>Up next</div>
            <div class="end-body">
              <a class="end-thumb" data-end-link href="#" data-link><img data-end-thumb alt=""></a>
              <div>
                <a data-end-link href="#" data-link><div class="end-title" data-end-title></div></a>
                <div class="end-sub" data-end-sub></div>
              </div>
            </div>
            <div class="end-progress"><i data-end-progress></i></div>
            <div class="end-related" data-end-related></div>
          </div>
          <div class="end-actions">
            <span class="end-count" data-end-count></span>
            <button class="btn-ghost" type="button" data-end-act="cancel">Cancel</button>
            <button class="btn-light" type="button" data-end-act="play">Play now</button>
            <button class="btn-light" type="button" data-end-act="replay" hidden>Replay</button>
          </div>
        </div>
      </div>

      <h1 class="watch-title" data-yt-title>${esc(title)}</h1>

      <div class="watch-meta-row">
        <div class="watch-views" data-yt-meta>${esc(meta || 'Loading…')}</div>
        <div class="watch-actions">
          <button class="action-btn" type="button" data-yt-rate title="Playback speed">${icon('gauge')} <span data-yt-rate-label>${rate}×</span></button>
          <button class="action-btn" type="button" data-yt-quality title="Video quality">${icon('hd')} <span data-yt-quality-label>${esc(quality)}</span></button>
          <a class="action-btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${icon('play')} Open on YouTube</a>
          <button class="action-btn" data-copy-remote>${icon('share')} Copy link</button>
        </div>
      </div>

      <div class="desc" data-desc ${info?.description ? '' : 'hidden'}>
        <div class="desc-text" data-yt-text>${esc(info?.description || '')}</div>
        <span class="desc-toggle" data-desc-toggle>Show more</span>
      </div>
    </div>

    <aside class="related" aria-label="More videos on YouTube">
      <section class="up-next" data-up-next>
        <div class="related-head">
          <h2>Up Next</h2>
          <button class="autoplay-toggle" type="button" data-yt-autoplay aria-pressed="${autoplay}">
            <span class="switch ${autoplay ? 'on' : ''}"></span>Autoplay
          </button>
        </div>
        <div class="up-next-list" data-queue-list>${queue.map(queueItemHtml).join('')}</div>
        <p class="up-next-empty" data-queue-empty ${queue.length ? 'hidden' : ''}>Tap ${icon('plus')} on any video to line it up here.</p>
        <button class="text-btn up-next-clear" type="button" data-queue-clear ${queue.length ? '' : 'hidden'}>Clear queue</button>
      </section>

      <div class="related-head"><h2>More on YouTube</h2></div>
      <div data-yt-related-list><p class="related-empty">Loading…</p></div>
    </aside>
  </div>`;
}

export function mountRemoteWatch(root, id) {
  const playerEl = root.querySelector('[data-yt-player]');
  const playBtn = playerEl?.querySelector('[data-yt-play]');
  const saved = store.resumeFor(id);

  const meta = {
    title: saved?.title || root.querySelector('[data-yt-title]')?.textContent || 'YouTube video',
    channel: saved?.channel || '',
    thumb: saved?.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`,
  };

  const rateBtn = root.querySelector('[data-yt-rate]');
  const qualityBtn = root.querySelector('[data-yt-quality]');

  const currentRate = () => {
    const value = Number(store.state.ytRate);
    return YT_RATES.includes(value) ? value : 1;
  };
  const currentQuality = () =>
    YT_QUALITIES.some(([value]) => value === store.state.ytQuality) ? store.state.ytQuality : 'auto';

  const paintPrefs = () => {
    const rateLabel = root.querySelector('[data-yt-rate-label]');
    if (rateLabel) rateLabel.textContent = `${currentRate()}×`;
    const qualityLabel = root.querySelector('[data-yt-quality-label]');
    if (qualityLabel) {
      qualityLabel.textContent = YT_QUALITIES.find(([value]) => value === currentQuality())[1];
    }
  };

  let frame = null;
  let duration = saved?.d || 0;
  let position = saved?.t || 0;
  let startAt = saved?.t || 0;
  let actualQuality = '';
  let seeked = !saved;
  let lastSave = 0;
  let listenTimer = null;
  let seekTimer = null;
  let listenTries = 0;
  let destroyed = false;
  let relatedVideos = [];
  let endTimer = null;
  let endVisible = false;
  let endSuppressed = false;

  const endCard = playerEl?.querySelector('[data-yt-end]');

  const send = (payload) => {
    try {
      frame?.contentWindow?.postMessage(JSON.stringify(payload), '*');
    } catch {
      /* the frame went away */
    }
  };

  /* Rate is honoured by the embed. Quality commands are still sent because
     older players support them, but YouTube usually keeps its own adaptive
     quality; the menu shows what is actually playing. */
  const applyPrefs = () => {
    if (!frame) return;
    send({ event: 'command', func: 'setPlaybackRate', args: [currentRate()] });
    const quality = currentQuality();
    send({
      event: 'command',
      func: 'setPlaybackQuality',
      args: [quality === 'auto' ? 'default' : quality],
    });
  };

  const save = (force = false) => {
    if (destroyed || !duration || !position) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    store.saveResume({ ...meta, id, t: position, d: duration });
  };

  const seekTo = (time, announce) => {
    if (!Number.isFinite(time) || time < 0) return;
    position = time;
    startAt = time;
    send({ event: 'command', func: 'seekTo', args: [time, true] });
    if (announce) {
      toast(`Resumed from ${fmtDuration(time)}`, {
        action: 'Start over',
        onAction: () => {
          seekTo(0, false);
          store.removeResume(id);
        },
      });
    }
  };

  /* YouTube only reports duration once, in initialDelivery. Wait for it, then
     jump to the saved spot exactly once so it can't fight the user seeking. */
  const maybeSeek = () => {
    if (seeked || destroyed || !duration) return;
    if (startAt < 4 || startAt > duration - 6) {
      seeked = true;
      return;
    }
    seeked = true;
    seekTimer = setTimeout(() => {
      if (!destroyed) seekTo(startAt, true);
    }, 700);
  };

  /* ---------------------------------------------------------- up next */

  const paintQueue = () => {
    const list = root.querySelector('[data-queue-list]');
    const empty = root.querySelector('[data-queue-empty]');
    const clear = root.querySelector('[data-queue-clear]');
    const queue = store.queueList();
    if (list) list.innerHTML = queue.map(queueItemHtml).join('');
    if (empty) empty.hidden = queue.length > 0;
    if (clear) clear.hidden = queue.length === 0;
  };

  const nextUp = () => store.queueList()[0] || relatedVideos[0] || null;

  const hideEndCard = () => {
    endVisible = false;
    clearInterval(endTimer);
    endTimer = null;
    endCard?.classList.remove('visible');
    const bar = endCard?.querySelector('[data-end-progress]');
    if (bar) bar.style.width = '0%';
  };

  const playNext = (video = nextUp()) => {
    if (!video?.id || destroyed) return;
    hideEndCard();
    store.removeFromQueue(video.id);
    save(true);
    navigate(`/watch/yt/${encodeURIComponent(video.id)}?autoplay=1`);
  };

  const replay = () => {
    hideEndCard();
    endSuppressed = false;
    store.removeResume(id);
    seekTo(0, false);
    send({ event: 'command', func: 'playVideo', args: [] });
  };

  const showEndCard = () => {
    if (!endCard || destroyed || endVisible || endSuppressed) return;
    endVisible = true;
    endCard.classList.add('visible');

    const label = endCard.querySelector('[data-end-label]');
    const title = endCard.querySelector('[data-end-title]');
    const sub = endCard.querySelector('[data-end-sub]');
    const thumb = endCard.querySelector('[data-end-thumb]');
    const links = [...endCard.querySelectorAll('[data-end-link]')];
    const count = endCard.querySelector('[data-end-count]');
    const bar = endCard.querySelector('[data-end-progress]');
    const play = endCard.querySelector('[data-end-act="play"]');
    const replayBtn = endCard.querySelector('[data-end-act="replay"]');
    const next = nextUp();

    // "Also next": whatever is queued, then the related rail, without repeats.
    const also = [...store.queueList(), ...relatedVideos]
      .filter((v) => v.id !== id && v.id !== next?.id)
      .filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i)
      .slice(0, 3);
    const alsoEl = endCard.querySelector('[data-end-related]');
    if (alsoEl) alsoEl.innerHTML = also.map(ytEndItemHtml).join('');

    if (!next) {
      label.textContent = 'Finished';
      title.textContent = 'Nothing left in the queue';
      sub.textContent = 'Replay this video or pick one from More on YouTube.';
      thumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
      thumb.alt = '';
      links.forEach((a) => a.removeAttribute('href'));
      count.textContent = '';
      bar.style.width = '0%';
      play.hidden = true;
      replayBtn.hidden = false;
      clearInterval(endTimer);
      return;
    }

    const fromQueue = store.queueList()[0]?.id === next.id;
    label.textContent = fromQueue ? 'Next in your queue' : 'Up next';
    title.textContent = next.title;
    sub.textContent = next.channel || 'YouTube';
    thumb.src = next.thumb;
    thumb.alt = '';
    links.forEach((a) => {
      a.href = `/watch/yt/${encodeURIComponent(next.id)}?autoplay=1`;
    });
    play.hidden = false;
    replayBtn.hidden = true;

    if (!store.state.autoplay) {
      count.textContent = 'Autoplay is off';
      bar.style.width = '0%';
      clearInterval(endTimer);
      return;
    }

    const total = 8000;
    const started = Date.now();
    clearInterval(endTimer);
    endTimer = setInterval(() => {
      const left = total - (Date.now() - started);
      count.textContent = `Next in ${Math.max(0, Math.ceil(left / 1000))}`;
      bar.style.width = `${Math.min(100, Math.max(0, 100 - (left / total) * 100))}%`;
      if (left <= 0) {
        clearInterval(endTimer);
        playNext(next);
      }
    }, 200);
  };

  const onMessage = (event) => {
    if (destroyed || !frame || event.source !== frame.contentWindow) return;
    let data = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;

    if (data.event === 'onReady' || data.event === 'initialDelivery') applyPrefs();

    const info = data.info;
    if (!info || typeof info !== 'object') return;

    if (typeof info.playbackQuality === 'string' && info.playbackQuality !== 'unknown') {
      actualQuality = info.playbackQuality;
    }

    // duration is reliable in initialDelivery; some videos only send time later
    if (typeof info.duration === 'number' && info.duration > 0) {
      duration = info.duration;
    } else {
      const seconds = Number(info.videoData?.videoDetails?.lengthSeconds);
      if (Number.isFinite(seconds) && seconds > 0) duration = seconds;
    }

    if (typeof info.currentTime === 'number') {
      position = info.currentTime;
      // Don't wait for playerState: several videos omit it from infoDelivery.
      if (duration) {
        maybeSeek();
        if (position >= duration - 2) store.removeResume(id);
        else if (position > 4) save();
      }
    }

    const state = typeof info.playerState === 'number' ? info.playerState : null;
    if (state === 2) save(true);
    else if (state === 0) {
      store.removeResume(id);
      showEndCard();
    } else if (state === 1 || state === 3) {
      endSuppressed = false;
    }
  };

  /* Ask the player to report its clock. A few retries covers slow loads. */
  const listen = () => {
    if (destroyed || !frame) return;
    send({ event: 'listening', id: `dinosour-${id}` });
    listenTries += 1;
    listenTimer = listenTries < 8 ? setTimeout(listen, 1200) : null;
  };

  const onHide = () => {
    if (document.visibilityState === 'hidden') save(true);
  };

  const onPageHide = () => save(true);

  const destroy = () => {
    if (destroyed) return;
    save(true);
    destroyed = true;
    window.removeEventListener('message', onMessage);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    clearTimeout(listenTimer);
    clearTimeout(seekTimer);
    clearInterval(endTimer);
    send({ event: 'command', func: 'pauseVideo', args: [] });
    frame = null;
  };

  window.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);

  const startPlayback = () => {
    if (!playerEl || playerEl.classList.contains('playing')) return;
    frame = document.createElement('iframe');
    frame.className = 'yt-frame';
    const startParam =
      saved && saved.t >= 4 && (!saved.d || saved.t < saved.d - 6) ? `&start=${Math.floor(saved.t)}` : '';
    frame.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&color=white&enablejsapi=1${startParam}${APP_MODE ? '' : `&origin=${encodeURIComponent(location.origin)}`}`;
    frame.title = root.querySelector('[data-yt-title]')?.textContent || 'YouTube video';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    playerEl.replaceChildren(frame);
    // keep the end screen mounted above the iframe
    if (endCard) playerEl.append(endCard);
    playerEl.classList.add('playing');
    frame.addEventListener('load', () => {
      listenTries = 0;
      listen();
    });
  };

  playBtn?.addEventListener('click', startPlayback);
  root.querySelector('[data-copy-remote]')?.addEventListener('click', () => copyLink());

  // This video is playing now, so it no longer waits in Up Next.
  store.removeFromQueue(id);
  paintQueue();

  root.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-queue]');
    if (add) {
      const added = store.addToQueue({
        id: add.dataset.addQueue,
        title: add.dataset.qTitle,
        channel: add.dataset.qChannel,
        thumb: add.dataset.qThumb,
        length: add.dataset.qLength,
      });
      paintQueue();
      toast(added ? 'Added to Up Next' : 'Already in Up Next');
      return;
    }

    const remove = event.target.closest('[data-queue-remove]');
    if (remove) {
      store.removeFromQueue(remove.dataset.queueRemove);
      paintQueue();
      toast('Removed from Up Next');
      return;
    }

    if (event.target.closest('[data-queue-clear]')) {
      store.clearQueue();
      paintQueue();
      toast('Up Next cleared');
    }
  });

  root.querySelector('[data-yt-autoplay]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const on = !store.state.autoplay;
    store.set('autoplay', on);
    button.setAttribute('aria-pressed', String(on));
    button.querySelector('.switch')?.classList.toggle('on', on);
    toast(on ? 'Autoplay on' : 'Autoplay off');
  });

  endCard?.addEventListener('click', (event) => {
    const act = event.target.closest('[data-end-act]')?.dataset.endAct;
    if (act === 'play') playNext();
    else if (act === 'replay') replay();
    else if (act === 'cancel') {
      endSuppressed = true;
      hideEndCard();
    }
  });

  paintPrefs();

  rateBtn?.addEventListener('click', () => {
    const current = currentRate();
    openMenu(
      rateBtn,
      YT_RATES.map((rate) => ({
        key: `rate-${rate}`,
        label: rate === 1 ? 'Normal (1×)' : `${rate}×`,
        checked: current === rate,
        onClick: () => {
          store.set('ytRate', rate);
          paintPrefs();
          send({ event: 'command', func: 'setPlaybackRate', args: [rate] });
          toast(rate === 1 ? 'Normal speed' : `Speed ${rate}×`);
        },
      }))
    );
  });

  qualityBtn?.addEventListener('click', () => {
    const actual = YT_QUALITY_NAMES[actualQuality];
    openMenu(qualityBtn, [
      {
        note: actual
          ? `Playing at ${actual}. YouTube can still adjust this automatically.`
          : 'YouTube adjusts quality automatically based on your connection.',
      },
      ...YT_QUALITIES.map(([value, label]) => ({
        key: `quality-${value}`,
        label: value === 'auto' ? 'Auto (recommended)' : label,
        checked: currentQuality() === value,
        onClick: () => {
          store.set('ytQuality', value);
          paintPrefs();
          send({
            event: 'command',
            func: 'setPlaybackQuality',
            args: [value === 'auto' ? 'default' : value],
          });
          toast(value === 'auto' ? 'Quality set to auto' : `Prefer ${label} — YouTube may adjust`);
        },
      })),
    ]);
  });

  // Reached from an end screen: start this video without a second tap.
  if (new URLSearchParams(location.search).get('autoplay') === '1') {
    startPlayback();
    history.replaceState(history.state, '', location.pathname);
  }

  const desc = root.querySelector('[data-desc]');
  desc?.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const open = desc.classList.toggle('expanded');
    desc.querySelector('[data-desc-toggle]').textContent = open ? 'Show less' : 'Show more';
  });

  (async () => {
    const info = await videoInfo(id);
    if (destroyed || !playerEl?.isConnected) return;

    let channel = '';
    if (info) {
      channel = info.channel || '';
      meta.title = info.title || meta.title;
      meta.channel = info.channel || meta.channel;
      const titleEl = root.querySelector('[data-yt-title]');
      if (titleEl) titleEl.textContent = info.title;
      document.title = `${info.title} — dinosour`;

      const metaEl = root.querySelector('[data-yt-meta]');
      const infoMeta = remoteMeta(info);
      if (metaEl && infoMeta) metaEl.textContent = infoMeta;

      if (info.description) {
        desc.hidden = false;
        root.querySelector('[data-yt-text]').textContent = info.description;
      }
    }

    const relatedEl = root.querySelector('[data-yt-related-list]');
    if (!relatedEl) return;

    const seed = channel || root.dataset.query || '';
    if (!seed) {
      relatedEl.innerHTML = '<p class="related-empty">No related videos found.</p>';
      return;
    }

    try {
      const data = await searchYouTube(seed);
      if (destroyed || !playerEl?.isConnected) return;
      const videos = (data.videos || []).filter((v) => v.id !== id).slice(0, 12);
      relatedVideos = videos;
      relatedEl.innerHTML = videos.length
        ? videos.map(ytRelItemHtml).join('')
        : '<p class="related-empty">No related videos found.</p>';
    } catch {
      if (playerEl?.isConnected) {
        relatedEl.innerHTML = '<p class="related-empty">Related videos are unavailable right now.</p>';
      }
    }
  })();

  return { destroy };
}

function resultItemHtml(v) {
  const ch = v.channelData;
  const desc = (v.description || '').replace(/\s+/g, ' ').slice(0, 190);
  return `<a class="result" href="/watch/${v.id}" data-link>
    <div class="thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="640" height="360">
      <span class="duration">${fmtDuration(v.duration)}</span>
    </div>
    <div class="result-info">
      <h3 class="result-title">${esc(v.title)}</h3>
      <div class="result-meta">${compact(v.views)} views &middot; ${timeAgo(v.published)}</div>
      <div class="result-channel">${avatar(ch)}<span>${esc(ch.name)}</span>${ch.verified ? verifiedIcon() : ''}</div>
      <div class="result-desc">${esc(desc)}</div>
    </div>
  </a>`;
}

/* ============================================================ library */

export function renderLibrary(kind) {
  if (kind === 'history') return renderHistory();
  if (kind === 'liked') return renderGridPage('liked');
  return renderGridPage('watch-later');
}

function libraryTabs(active) {
  const tabs = [
    ['history', 'History', '/feed/history'],
    ['watch-later', 'Watch later', '/feed/watch-later'],
    ['liked', 'Liked', '/feed/liked'],
  ];
  return `<nav class="library-tabs" aria-label="Library">${tabs
    .map(
      ([key, label, href]) =>
        `<a class="library-tab${key === active ? ' active' : ''}" href="${href}" data-link>${label}</a>`
    )
    .join('')}</nav>`;
}

function renderHistory() {
  const rows = store.state.history
    .map((h) => ({ video: videoById(h.id), at: h.at }))
    .filter((x) => x.video);

  if (!rows.length) {
    return `<div class="page">${libraryTabs('history')}${emptyState({
      iconName: 'history',
      title: 'No watch history',
      text: 'Videos you watch will show up here, so you can pick up where you left off.',
      actionHref: '/',
      actionText: 'Find something to watch',
    })}</div>`;
  }

  return `<div class="page">
    ${libraryTabs('history')}
    <div class="page-head">
      <h1>${icon('history')} Watch history</h1>
      <span class="spacer"></span>
      <button class="action-btn" data-clear-history>${icon('trash')} Clear all history</button>
    </div>
    <div data-history-list>
      ${rows
        .map(({ video: v, at }) => {
          const ch = v.channelData;
          return `<div class="history-row" data-history-id="${v.id}">
            <a href="/watch/${v.id}" data-link class="thumb">
              <img src="${esc(v.thumb)}" alt="" loading="lazy">
              <span class="duration">${fmtDuration(v.duration)}</span>
            </a>
            <a href="/watch/${v.id}" data-link class="history-info">
              <div class="history-title">${esc(v.title)}</div>
              <div class="history-sub">${esc(ch.name)} &middot; ${compact(v.views)} views</div>
              <div class="history-sub">Watched ${timeAgo(new Date(at).toISOString())}</div>
            </a>
            <button class="icon-btn" data-remove-history="${v.id}" aria-label="Remove from history">${icon('x')}</button>
          </div>`;
        })
        .join('')}
    </div>
  </div>`;
}

function renderGridPage(kind) {
  const ids = kind === 'liked' ? store.likedIds() : store.savedIds();
  const videos = ids.map((id) => videoById(id)).filter(Boolean);
  const meta = {
    liked: {
      title: 'Liked videos',
      icon: 'thumb-up',
      emptyTitle: 'No liked videos yet',
      emptyText: 'Tap the thumbs up on any video and it will be collected here.',
      emptyAction: 'Find something to like',
    },
    'watch-later': {
      title: 'Watch later',
      icon: 'clock',
      emptyTitle: 'Nothing saved yet',
      emptyText: 'Hit Save on a video to keep it here for later.',
      emptyAction: 'Browse home',
    },
  }[kind];

  if (!videos.length) {
    return `<div class="page">${libraryTabs(kind)}${emptyState({
      iconName: meta.icon === 'thumb-up' ? 'thumb-up' : meta.icon,
      title: meta.emptyTitle,
      text: meta.emptyText,
      actionHref: '/',
      actionText: meta.emptyAction,
    })}</div>`;
  }

  return `${libraryTabs(kind)}<div class="page-head" style="padding:24px 24px 0;max-width:1400px;margin:0 auto">
      <h1>${icon(meta.icon)} ${meta.title}</h1>
      <span class="spacer"></span>
      <span class="page-count">${videos.length} video${videos.length === 1 ? '' : 's'}</span>
    </div>
    <div class="grid">${videos.map(cardHtml).join('')}</div>`;
}

export function mountLibrary(root, kind) {
  if (kind !== 'history') return {};
  const clear = root.querySelector('[data-clear-history]');
  clear?.addEventListener('click', () => {
    openMenu(clear, [
      {
        key: 'clear',
        icon: 'trash',
        label: 'Clear all watch history',
        onClick: () => {
          store.clearHistory();
          toast('Watch history cleared');
          navigate('/feed/history', { replace: true });
        },
      },
    ]);
  });
  root.querySelector('[data-history-list]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-history]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    store.removeHistory(btn.dataset.removeHistory);
    btn.closest('.history-row')?.remove();
    toast('Removed from history');
    if (!root.querySelector('.history-row')) navigate('/feed/history', { replace: true });
  });
  return {};
}

/* ============================================================ trending */

export function renderTrending() {
  if (APP_MODE) {
    return `<div class="page-head" style="padding:24px 24px 0;max-width:1400px;margin:0 auto">
        <h1>${icon('flame')} Trending</h1>
        <span class="spacer"></span>
        <span class="page-count">Popular on YouTube</span>
      </div>
      <div class="grid" data-home-more-grid></div>
      <div class="feed-loader" data-home-more hidden><span class="spinner"></span></div>
      <div class="feed-end" data-home-end hidden>
        <button type="button" class="btn-more" data-home-retry>Try again</button>
      </div>
      <div class="feed-sentinel" data-home-sentinel aria-hidden="true"></div>`;
  }

  const list = [...longVideos(), ...shortVideos()].sort((a, b) => (b.views || 0) - (a.views || 0));
  return `<div class="page-head" style="padding:24px 24px 0;max-width:1400px;margin:0 auto">
      <h1>${icon('flame')} Trending</h1>
      <span class="spacer"></span>
      <span class="page-count">Most watched in the library</span>
    </div>
    <div class="grid">${list.map(cardHtml).join('')}</div>`;
}

/* ============================================================ channel */

export function renderChannel(id) {
  const ch = channelById(id);
  const videos = channelVideos(id);
  const shorts = videos.filter((v) => v.short);
  const longs = videos.filter((v) => !v.short);
  if (!videos.length) {
    return `<div class="page">${emptyState({
      iconName: 'film',
      title: 'Channel not found',
      text: 'That channel does not exist in this library.',
      actionHref: '/',
      actionText: 'Back to home',
    })}</div>`;
  }

  return `<div class="channel-banner" style="background:linear-gradient(120deg, ${ch.color}, ${shade(ch.color, -58)})">
      <div class="channel-banner-pattern"></div>
    </div>
    <div class="channel-head">
      ${avatar(ch, 'xl')}
      <div class="channel-head-info">
        <h1>${esc(ch.name)} ${ch.verified ? verifiedIcon() : ''}</h1>
        <div class="channel-facts">
          <span>${esc(ch.handle || '')}</span>
          <span>${compact(ch.videoCount)} videos</span>
          <span>${compact(ch.totalViews)} views</span>
        </div>
        <p class="channel-desc">${esc(ch.description || '')}</p>
      </div>
    </div>
    <div class="channel-tabs">
      <button class="channel-tab active" data-tab="videos">Videos <span class="tab-count">${longs.length}</span></button>
      ${shorts.length ? `<button class="channel-tab" data-tab="shorts">Shorts <span class="tab-count">${shorts.length}</span></button>` : ''}
    </div>
    <div class="grid" data-channel-grid>${longs.map(cardHtml).join('')}</div>`;
}

export function mountChannel(root, id) {
  const videos = channelVideos(id);
  const grid = root.querySelector('[data-channel-grid]');
  root.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      const list = tab.dataset.tab === 'shorts' ? videos.filter((v) => v.short) : videos.filter((v) => !v.short);
      grid.innerHTML = list.map(cardHtml).join('');
    });
  });
  return {};
}

/* ============================================================ not found */

export function renderNotFound() {
  return `<div class="page">${emptyState({
    iconName: 'film',
    title: 'This page does not exist',
    text: 'The link may be broken, or the video was removed from the library.',
    actionHref: '/',
    actionText: 'Back to home',
  })}</div>`;
}

/* ============================================================ settings */

export function settingsTopicsHtml() {
  const topics = store.customTopics();
  if (!topics.length) return '<span class="settings-empty">No topics yet. Add one and it becomes a button on your home feed.</span>';
  return topics
    .map(
      (t) =>
        `<span class="topic-pill">${esc(t)}<button type="button" data-topic-remove="${esc(t)}" aria-label="Remove ${esc(t)}">${icon('x')}</button></span>`
    )
    .join('');
}

export function renderSettings() {
  const app = APP_MODE;
  return `<div class="page settings-page">
    <div class="settings-head">
      <span class="settings-kicker">${icon('sliders')} Preferences</span>
      <h1>Settings</h1>
      <p>Everything stays on this device. No account, no sign-in.</p>
    </div>

    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2>Updates</h2>
          <p>${
            app
              ? 'dinosour checks for new versions automatically, downloads them quietly, and pops up when one is ready. You only tap Install.'
              : 'Automatic updates are built into the Android app.'
          }</p>
        </div>
        <span class="settings-badge ${app ? 'badge-live' : ''}">${app ? 'Automatic' : 'App only'}</span>
      </div>
      <div class="settings-line">
        <span>Current version</span>
        <strong data-app-version>${app ? '…' : 'Web'}</strong>
      </div>
      <div class="settings-actions">
        <button type="button" class="btn-primary" data-check-update ${app ? '' : 'disabled'}>${icon('refresh')} Check for updates</button>
        <button type="button" class="btn-outline" data-install-update hidden>${icon('download')} Install update</button>
      </div>
      <p class="settings-status" data-update-status role="status"></p>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2>Your topics</h2>
          <p>These are the buttons above your home feed. Add anything you like — football, cooking, lofi, anything.</p>
        </div>
        <span class="settings-badge" data-topic-count>${store.customTopics().length} / 12</span>
      </div>
      <div class="settings-topics" data-settings-topics>${settingsTopicsHtml()}</div>
      <div class="settings-actions">
        <button type="button" class="btn-outline" data-manage-topics>${icon('plus')} Add or edit topics</button>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2>Appearance</h2>
          <p>Pick the look you prefer.</p>
        </div>
      </div>
      <div class="theme-choice" data-theme-choice>
        <button type="button" class="theme-option" data-theme-pick="dark">${icon('moon')} Dark</button>
        <button type="button" class="theme-option" data-theme-pick="light">${icon('sun')} Light</button>
      </div>
    </section>

    <p class="settings-foot">dinosour · Powered by YouTube · No ads, no tracking.</p>
  </div>`;
}
