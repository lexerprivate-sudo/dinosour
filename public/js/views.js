/* Page rendering. Each render* returns HTML; mount* wires behavior. */

import { Player } from './player.js';
import { store } from './store.js';
import {
  categories,
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

function chipsHtml(active = 'All') {
  const list = ['All', ...categories()];
  return `<div class="chips-wrap"><div class="chips" role="tablist" aria-label="Categories">${list
    .map(
      (c) =>
        `<button class="chip ${c === active ? 'active' : ''}" data-chip="${esc(c)}" role="tab" aria-selected="${c === active}">${esc(c)}</button>`
    )
    .join('')}</div></div>`;
}

export function renderHome({ category = 'All' } = {}) {
  const pool = APP_MODE ? [] : longVideos();
  const list = APP_MODE ? [] : category === 'All' ? pool : pool.filter((v) => v.category === category);
  const shorts = APP_MODE ? [] : shortVideos();

  if (!APP_MODE && !list.length) {
    return `${chipsHtml(category)}${emptyState({
      iconName: 'film',
      title: 'Nothing here yet',
      text: `There are no videos in “${category}” right now. Try another category.`,
      actionHref: '/',
      actionText: 'Back to home',
    })}`;
  }

  const head = list.slice(0, 8);
  const tail = list.slice(8);

  return `${chipsHtml(category)}
  ${head.length ? `<div class="grid">${head.map(cardHtml).join('')}</div>` : ''}
  ${category === 'All' && shorts.length ? shortsSection(shorts) : ''}
  ${tail.length ? `<div class="grid">${tail.map(cardHtml).join('')}</div>` : ''}
  <div class="grid" data-home-more-grid></div>
  <div class="feed-loader" data-home-more hidden><span class="spinner"></span></div>
  <div class="feed-end" data-home-end hidden>
    <button type="button" class="btn-more" data-home-retry>Try again</button>
  </div>
  <div class="feed-sentinel" data-home-sentinel aria-hidden="true"></div>`;
}

const FEED_SEEDS = {
  All: ['lofi music', 'space documentary', '4k nature', 'travel film', 'live music', 'technology', 'food', 'animated short film'],
  Animation: ['animated short film', '3d animation', 'animation'],
  Space: ['space documentary', 'nasa', 'astronomy'],
  Travel: ['travel vlog', 'walking tour 4k', 'travel'],
  Food: ['food recipe', 'street food', 'cooking'],
  Music: ['lofi music', 'live music', 'music'],
  Tech: ['technology', 'programming', 'gadgets'],
  Nature: ['nature documentary', '4k nature', 'wildlife'],
};

const TRENDING_SEEDS = ['trending now', 'popular videos', 'viral videos', 'top music', 'new trailers'];

/** Infinite home feed: the local library first, then live YouTube results. */
export async function mountHome(root, category = 'All') {
  return mountFeed(root, FEED_SEEDS[category] || FEED_SEEDS.All);
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

function ytRelItemHtml(v) {
  return `<a class="rel-item" href="/watch/yt/${encodeURIComponent(v.id)}" data-link>
    <div class="rel-thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="320" height="180">
      ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
    </div>
    <div class="rel-text">
      <div class="rel-title">${esc(v.title)}</div>
      <div class="rel-channel">${esc(v.channel)}</div>
      <div class="rel-meta">${esc([v.viewsText, v.publishedText].filter(Boolean).join(' · '))}</div>
    </div>
  </a>`;
}

/* ==================================================== YouTube watch */

function remoteMeta(info) {
  if (!info) return '';
  const published = info.published ? timeAgo(info.published) : info.publishedText;
  return [info.viewsText, published].filter(Boolean).join(' · ');
}

export function renderRemoteWatch(id, info = null) {
  const title = info?.title || 'YouTube video';
  const meta = remoteMeta(info);

  return `<div class="watch yt-watch">
    <div class="watch-main">
      <div class="player yt-player" data-yt-player data-id="${encodeURIComponent(id)}">
        <img class="yt-poster" src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg" alt="" width="480" height="360">
        <button class="yt-play" type="button" data-yt-play aria-label="Play video">
          <span class="yt-play-btn">${icon('play')}</span>
        </button>
      </div>

      <h1 class="watch-title" data-yt-title>${esc(title)}</h1>

      <div class="watch-meta-row">
        <div class="watch-views" data-yt-meta>${esc(meta || 'Loading…')}</div>
        <div class="watch-actions">
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
      <div class="related-head"><h2>More on YouTube</h2></div>
      <div data-yt-related-list><p class="related-empty">Loading…</p></div>
    </aside>
  </div>`;
}

export async function mountRemoteWatch(root, id) {
  const playerEl = root.querySelector('[data-yt-player]');
  const playBtn = playerEl?.querySelector('[data-yt-play]');

  const startPlayback = () => {
    if (!playerEl || playerEl.classList.contains('playing')) return;
    const frame = document.createElement('iframe');
    frame.className = 'yt-frame';
    frame.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&color=white${APP_MODE ? '' : `&origin=${encodeURIComponent(location.origin)}`}`;
    frame.title = root.querySelector('[data-yt-title]')?.textContent || 'YouTube video';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    playerEl.replaceChildren(frame);
    playerEl.classList.add('playing');
  };

  playBtn?.addEventListener('click', startPlayback);
  root.querySelector('[data-copy-remote]')?.addEventListener('click', () => copyLink());

  const desc = root.querySelector('[data-desc]');
  desc?.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const open = desc.classList.toggle('expanded');
    desc.querySelector('[data-desc-toggle]').textContent = open ? 'Show less' : 'Show more';
  });

  const info = await videoInfo(id);
  if (!playerEl?.isConnected) return;

  let channel = '';
  if (info) {
    channel = info.channel || '';
    const titleEl = root.querySelector('[data-yt-title]');
    if (titleEl) titleEl.textContent = info.title;
    document.title = `${info.title} — dinosour`;

    const metaEl = root.querySelector('[data-yt-meta]');
    const meta = remoteMeta(info);
    if (metaEl && meta) metaEl.textContent = meta;

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
    if (!playerEl?.isConnected) return;
    const videos = (data.videos || []).filter((v) => v.id !== id).slice(0, 12);
    relatedEl.innerHTML = videos.length
      ? videos.map(ytRelItemHtml).join('')
      : '<p class="related-empty">No related videos found.</p>';
  } catch {
    if (playerEl?.isConnected) {
      relatedEl.innerHTML = '<p class="related-empty">Related videos are unavailable right now.</p>';
    }
  }
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
