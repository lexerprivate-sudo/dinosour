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
import { avatarStyle, compact, esc, exact, fmtDuration, initials, parseLength, shade, shuffleArray, timeAgo, APP_MODE } from './util.js';
import { navigate, openMenu, openPrompt, toast } from './ui.js';
import { searchYouTube, videoInfo } from './yt.js';
import { buildMix, dedupeTracks, withSeedTrack } from './mix.js';
import { clearMediaTarget, isAppVisible, reportMedia, setMediaTarget } from './media.js';

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
  // The bundled original/demo library lives in the app; on localhost it is
  // only test content, so keep it out of the way there.
  const showLocal = APP_MODE && !isTopic;
  const list = showLocal ? longVideos().filter((v) => !store.isFiltered(v)) : [];
  const shorts = showLocal ? shortVideos().filter((v) => !store.isFiltered(v)) : [];

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
  ${!isTopic ? mixesRailHtml() : ''}
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

/* Recent auto-generated mixes, shown on Home for quick access. */
function mixesRailHtml() {
  const mixes = store.recentMixes();
  if (!mixes.length) return '';
  return `<section class="resume-rail mixes-rail" aria-label="Music mixes">
    <div class="resume-head">
      <h2>${icon('shuffle')} Your mixes</h2>
      <a class="text-btn" href="/feed/mixes" data-link>See all</a>
    </div>
    <div class="resume-track">${mixes
      .slice(0, 8)
      .map(
        (m) => `<a class="mix-mini" href="/mix/${encodeURIComponent(m.id)}" data-link>
          <img src="${esc(m.seed?.thumb || '')}" alt="" loading="lazy">
          <span class="mix-mini-label">Mix</span>
          <span class="mix-mini-sub">${esc((m.seed?.title || '').slice(0, 40))}</span>
        </a>`
      )
      .join('')}</div>
  </section>`;
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

/**
 * Trending is grouped by category (News, Games, Dance, Sports, ...) and by a
 * time period. Every category owns its own topics; results are searched live,
 * filtered to the chosen period, and sorted by views. Sections load as they
 * scroll into view so opening the page does not fire dozens of requests.
 */
export async function mountTrending(root, { period, category, sort } = {}) {
  const sectionsEl = root.querySelector('[data-trend-sections]');
  if (!sectionsEl) return {};
  const prefs = store.trendingPref();

  const state = {
    period: TREND_PERIODS.some(([key]) => key === period) ? period : prefs.period,
    sort: sort === 'newest' || sort === 'views' ? sort : prefs.sort,
    category: category || prefs.category,
    loaded: new Set(),
    cache: new Map(),
    limits: new Map(),
  };
  const pageLimit = () => (state.category === 'All' ? 8 : 24);

  const allSections = () => [...sectionsEl.querySelectorAll('[data-trend-section]')];
  const visibleSections = () =>
    allSections().filter(
      (el) => state.category === 'All' || el.dataset.trendSection === state.category
    );

  const syncUrl = () => {
    try {
      history.replaceState(
        history.state,
        '',
        `/feed/trending?period=${state.period}&sort=${state.sort}&cat=${encodeURIComponent(state.category)}`
      );
    } catch {
      /* custom-origin WebView may restrict replaceState */
    }
  };

  const loadSection = async (section) => {
    const name = section.dataset.trendSection;
    if (state.loaded.has(name) || section.hidden) return;
    state.loaded.add(name);
    const grid = section.querySelector('[data-trend-grid]');
    if (!grid) return;
    grid.innerHTML = '<div class="trend-loading"><span class="spinner"></span></div>';

    const topics = store.trendingTopicsFor(name);
    if (!topics.length) {
      grid.innerHTML = trendEmpty(name);
      return;
    }

    const found = [];
    for (const topic of topics) {
      try {
        const data = await searchYouTube(topic);
        found.push(...(data.videos || []));
      } catch {
        /* one failed topic does not break the rest of the section */
      }
    }
    if (!section.isConnected) return;

    const unique = [...new Map(found.filter((v) => v && v.id).map((v) => [v.id, v])).values()];
    const limit = TREND_PERIOD_DAYS[state.period] ?? Infinity;
    const inPeriod = unique.filter((v) => {
      if (limit === Infinity) return true;
      const age = publishedAgeDays(v.publishedText);
      return age != null && age <= limit;
    });
    state.cache.set(name, { unique, inPeriod });
    state.limits.set(name, pageLimit());
    renderSection(section);
  };

  /** Renders a section from cached results; used by sort, load-more and reload. */
  const renderSection = (section) => {
    const name = section.dataset.trendSection;
    const grid = section.querySelector('[data-trend-grid]');
    const more = section.querySelector('[data-trend-more]');
    const cached = state.cache.get(name);
    if (!grid || !cached) return;

    const base = cached.inPeriod.length ? cached.inPeriod : cached.unique;
    const ranked = [...base].sort((a, b) =>
      state.sort === 'newest'
        ? (publishedAgeDays(a.publishedText) ?? 1e9) - (publishedAgeDays(b.publishedText) ?? 1e9)
        : parseViews(b.viewsText) - parseViews(a.viewsText)
    );
    const limit = state.limits.get(name) || pageLimit();
    const chosen = ranked.slice(0, limit);
    const visible = chosen.filter((v) => !store.isFiltered(v));
    const note = !cached.inPeriod.length && cached.unique.length
      ? '<p class="trend-note">No uploads found in this period — showing the most popular available.</p>'
      : '';
    grid.innerHTML = visible.length
      ? `${note}<div class="grid">${visible.map(ytCardHtml).join('')}</div>`
      : trendEmpty(name, true);
    if (more) more.hidden = chosen.length >= ranked.length;
  };

  const refreshChips = (section) => {
    const list = section.querySelector('[data-trend-topic-list]');
    if (!list) return;
    list.innerHTML = trendTopicsHtml(section.dataset.trendSection);
    wireSection(section);
  };

  const promptTopic = (section) => {
    const name = section.dataset.trendSection;
    openPrompt({
      title: `Add a topic to ${name}`,
      label: 'Topic',
      placeholder: 'boxing, formula 1, cricket…',
      confirmText: 'Add',
      onSubmit: (value) => {
        const added = store.addTrendingTopic(name, value);
        if (!added) {
          toast('Could not add that topic — empty, duplicate, or the limit was reached.');
          return;
        }
        refreshChips(section);
        state.loaded.delete(name);
        loadSection(section);
        toast(`Added “${added}” to ${name}.`);
      },
    });
  };

  const wireSection = (section) => {
    section.querySelector('[data-trend-topic-add]')?.addEventListener('click', () => promptTopic(section));
    section.querySelectorAll('[data-trend-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.removeTrendingTopic(section.dataset.trendSection, btn.dataset.trendRemove);
        refreshChips(section);
        state.loaded.delete(section.dataset.trendSection);
        loadSection(section);
      });
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) loadSection(entry.target);
    },
    { rootMargin: '500px' }
  );

  allSections().forEach((section) => {
    wireSection(section);
    observer.observe(section);
    if (!section.hidden) loadSection(section);
  });

  root.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.period = btn.dataset.period;
      root.querySelectorAll('[data-period]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      state.loaded.clear();
      state.cache.clear();
      visibleSections().forEach(loadSection);
      store.setTrendingPref({ period: state.period });
      syncUrl();
    });
  });

  root.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort === 'newest' ? 'newest' : 'views';
      root.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('active', b === btn));
      visibleSections().forEach(renderSection);
      store.setTrendingPref({ sort: state.sort });
    });
  });

  sectionsEl.querySelectorAll('[data-trend-more]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.trendMore;
      state.limits.set(name, (state.limits.get(name) || pageLimit()) + pageLimit());
      const section = sectionsEl.querySelector(`[data-trend-section="${CSS.escape(name)}"]`);
      if (section) renderSection(section);
    });
  });

  const applyCategory = () => {
    allSections().forEach((el) => {
      const show = state.category === 'All' || el.dataset.trendSection === state.category;
      el.hidden = !show;
      state.limits.set(el.dataset.trendSection, pageLimit());
      if (show) {
        if (state.cache.has(el.dataset.trendSection)) renderSection(el);
        else loadSection(el);
      }
    });
    store.setTrendingPref({ category: state.category });
    syncUrl();
  };

  root.querySelectorAll('[data-trend-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.category = btn.dataset.trendCat;
      root.querySelectorAll('[data-trend-cat]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      applyCategory();
    });
  });

  root.querySelector('[data-trend-refresh]')?.addEventListener('click', () => {
    state.loaded.clear();
    state.cache.clear();
    visibleSections().forEach(loadSection);
  });

  root.querySelector('[data-trend-cat-add]')?.addEventListener('click', () => {
    openPrompt({
      title: 'Add a category',
      label: 'Category name',
      placeholder: 'Anime, Boxing, Podcasts…',
      confirmText: 'Add',
      onSubmit: (value) => {
        const name = store.addTrendingCategory(value);
        if (!name) {
          toast('That category already exists or has an invalid name.');
          return;
        }
        const tabs = root.querySelector('.trend-tabs');
        const addBtn = root.querySelector('[data-trend-cat-add]');
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'chip';
        tab.dataset.trendCat = name;
        tab.setAttribute('role', 'tab');
        tab.textContent = name;
        tabs.insertBefore(tab, addBtn);
        tab.addEventListener('click', () => {
          state.category = name;
          root.querySelectorAll('[data-trend-cat]').forEach((b) => {
            const active = b === tab;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', String(active));
          });
          applyCategory();
        });
        sectionsEl.insertAdjacentHTML('beforeend', trendSectionHtml(name));
        const section = sectionsEl.lastElementChild;
        wireSection(section);
        observer.observe(section);
        section.hidden = state.category !== 'All' && state.category !== name;
        if (!section.hidden) loadSection(section);
        toast(`Added ${name}. Now add topics inside it.`);
      },
    });
  });

  root.__feedCleanup = () => observer.disconnect();
  return {};
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
  let exhausted = false;
  const alive = () => sentinel.isConnected;

  const paint = () => {
    loader.hidden = !busy;
    end.hidden = !failed && !exhausted;
    if (retry) retry.hidden = exhausted;
  };

  const load = async () => {
    if (busy || exhausted || !alive()) return;
    busy = true;
    failed = false;
    paint();

    let added = 0;
    let attempts = 0;
    let emptyRuns = 0;
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
        const fresh = (data.videos || [])
          .filter((v) => v && v.id && !seen.has(v.id))
          .filter((v) => !store.isFiltered(v));
        for (const v of fresh) seen.add(v.id);
        if (fresh.length) {
          grid.insertAdjacentHTML('beforeend', fresh.map(ytCardHtml).join(''));
          added = fresh.length;
          emptyRuns = 0;
        } else if (!data.continuation && ++emptyRuns >= seeds.length) {
          // Every seed is exhausted: stop loading instead of firing up to 12
          // fresh searches on each subsequent scroll tick.
          exhausted = true;
          break;
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
    if (busy || failed || exhausted || !sentinel.isConnected) return;
    // The IntersectionObserver above is the sole scroll trigger; reading
    // getBoundingClientRect() on every scroll event forced a synchronous
    // layout on the UI thread.
    load();
  };

  retry?.addEventListener('click', () => {
    failed = false;
    exhausted = false;
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
      ...(/\.m3u8([?#]|$)/i.test(video.src)
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

const RESULT_SORTS = [
  ['relevance', 'Relevance'],
  ['views', 'Most viewed'],
  ['newest', 'Newest'],
];

export function renderResults({ query = '', sort = 'relevance' } = {}) {
  const q = (query || '').trim();
  const order = RESULT_SORTS.some(([k]) => k === sort) ? sort : 'relevance';
  if (!q) {
    return `<div class="results">${emptyState({
      iconName: 'search',
      title: 'Search',
      text: APP_MODE ? 'Search YouTube or this site.' : 'Search YouTube.',
      actionHref: '/',
      actionText: 'Browse home',
    })}</div>`;
  }

  const local = APP_MODE ? searchVideos(q) : [];
  const chans = APP_MODE ? searchChannels(q) : [];

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
    <div class="result-tools">
      ${RESULT_SORTS.map(
        ([key, label]) =>
          `<button type="button" class="result-sort ${key === order ? 'active' : ''}" data-result-sort="${key}" aria-pressed="${key === order}">${label}</button>`
      ).join('')}
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

export async function mountResults(root, query, sort = 'relevance') {
  // Remember the search that led here so Up Next on an opened video can use
  // the topic instead of the channel when the video title is unavailable.
  try {
    sessionStorage.setItem('dinosour.lastQuery', String(query || ''));
  } catch {
    /* storage may be unavailable */
  }
  const list = root.querySelector('[data-yt-list]');
  const more = root.querySelector('[data-yt-more]');
  const status = root.querySelector('[data-yt-status]');
  const sub = root.querySelector('[data-results-sub]');
  const loader = root.querySelector('[data-yt-loader]');
  const sentinel = root.querySelector('[data-yt-sentinel]');
  if (!list || !more || !status) return;

  const localCount = APP_MODE ? searchVideos(query).length : 0;
  let continuation = null;
  let busy = false;
  let failed = false;
  let order = RESULT_SORTS.some(([k]) => k === sort) ? sort : 'relevance';
  const all = [];
  const alive = () => list.isConnected;

  const applyView = () => {
    // General search results are not a music mix — dedupe by video id only.
    // Using dedupeTracks here threw away long videos, live streams and
    // multiple uploads from the same channel (and anything mentioning the
    // query words), which made ordinary searches look empty.
    const unique = new Map();
    for (const v of all) {
      if (!v?.id || store.isFiltered(v)) continue;
      if (!unique.has(v.id)) unique.set(v.id, v);
    }
    const shown = [...unique.values()].sort((a, b) =>
        order === 'views'
          ? parseViews(b.viewsText) - parseViews(a.viewsText)
          : order === 'newest'
            ? (publishedAgeDays(a.publishedText) ?? 1e9) - (publishedAgeDays(b.publishedText) ?? 1e9)
            : 0
      );
    list.innerHTML = shown.length
      ? shown.map(ytResultItemHtml).join('')
      : all.length
        ? '<p class="related-empty">No results left after filters.</p>'
        : '<p class="related-empty">No YouTube results found.</p>';
    return shown.length;
  };

  const paintCount = () => {
    const parts = [];
    if (localCount) parts.push(`${localCount} from this site`);
    const shown = all.filter((v) => !store.isFiltered(v)).length;
    if (shown) parts.push(`${shown} from YouTube`);
    sub.textContent = parts.join(' · ');
  };

  const setStatus = (message) => {
    status.textContent = message || '';
    status.hidden = !message;
  };

  const load = async (nextPage = false) => {
    if (busy) return;
    if (nextPage && !continuation) return;
    failed = false;
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
      all.push(...videos);
      continuation = data.continuation || null;
      const shown = applyView();
      more.hidden = !continuation;
      more.textContent = 'Show more results';
      delete more.dataset.retry;
      paintCount();

      if (!shown) {
        setStatus(all.length ? `All results for “${query}” are hidden by your filters.` : `No results for “${query}”.`);
      }
    } catch {
      if (!alive()) return;
      failed = true;
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
    if (busy || failed || !continuation || !sentinel || !alive()) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 900) load(true);
  };

  more.addEventListener('click', () => {
    if (more.dataset.retry !== undefined) {
      const retryNext = more.dataset.retry === '1';
      delete more.dataset.retry;
      failed = false;
      load(retryNext);
    } else {
      load(true);
    }
  });

  let observer = null;
  if (sentinel) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) maybeMore();
      },
      { rootMargin: '900px 0px' }
    );
    observer.observe(sentinel);
  }

  const onScroll = () => maybeMore();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  root.__feedCleanup = () => {
    observer?.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };

  root.querySelectorAll('[data-result-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      order = btn.dataset.resultSort;
      root.querySelectorAll('[data-result-sort]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      applyView();
      paintCount();
      // Persist the choice so reloads and shared links keep the same order.
      try {
        const url = new URL(location.href);
        url.searchParams.set('sort', order);
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } catch {
        /* history may be unavailable */
      }
    });
  });

  await load(false);
}

function ytCardHtml(v, extra = '', linkSuffix = '') {
  const channel = v.channel || 'YouTube';
  const meta = [v.viewsText, v.publishedText].filter(Boolean).join(' · ');
  const accountHref = `/channel/${encodeURIComponent(v.channelId || channel)}?yt=1&name=${encodeURIComponent(channel)}`;
  return `<article class="card yt-card">
  <a class="card-thumb-link" href="/watch/yt/${encodeURIComponent(v.id)}${linkSuffix}" data-link aria-hidden="true" tabindex="-1">
    <div class="thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy" width="640" height="360">
      ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
    </div>
  </a>
  <div class="card-details">
    <a class="account-avatar" href="${accountHref}" data-link title="See all ${esc(channel)} videos">${avatar({ name: channel, color: colorFor(channel) })}</a>
    <button type="button" class="yt-card-hide" data-yt-hide-channel="${esc(channel)}" title="Hide ${esc(channel)} videos">${icon('x')}</button>
    <div class="card-text">
      <a href="/watch/yt/${encodeURIComponent(v.id)}${linkSuffix}" data-link><h3 class="card-title">${esc(v.title)}</h3></a>
      <div class="card-channel"><a class="name account-link" href="/channel/${encodeURIComponent(v.channelId || channel)}?yt=1&name=${encodeURIComponent(channel)}" data-link title="Only ${esc(channel)} videos">${esc(channel)}</a></div>
      ${meta ? `<div class="card-meta">${esc(meta)}</div>` : ''}
    </div>
    ${extra}
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
      <div class="result-channel"><a class="account-link" href="/channel/${encodeURIComponent(v.channelId || v.channel)}?yt=1&name=${encodeURIComponent(v.channel)}" data-link title="Only ${esc(v.channel)} videos">${avatar({ name: v.channel, color: colorFor(v.channel) })}<span>${esc(v.channel)}</span></a></div>
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

function ytEndItemHtml(v, suffix = '') {
  return `<a class="end-related-item" href="/watch/yt/${encodeURIComponent(v.id)}?autoplay=1${suffix}" data-link>
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
  const captions = !!store.captionsEnabled();

  const queue = store.queueList();
  const autoplay = !!store.state.autoplay;
  const liked = store.isYtLiked(id);
  const savedYt = store.isYtSaved(id);

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
            <button class="btn-ghost" type="button" data-end-act="prev">Previous</button>
            <button class="btn-ghost" type="button" data-end-act="cancel">Cancel</button>
            <button class="btn-light" type="button" data-end-act="play">Play now</button>
            <button class="btn-light" type="button" data-end-act="replay" hidden>Replay</button>
          </div>
        </div>
      </div>

      <div class="watch-channel-row" data-yt-channel-row></div>
      <h1 class="watch-title" data-yt-title>${esc(title)}</h1>

      <div class="watch-meta-row">
        <div class="watch-views" data-yt-meta>${esc(meta || 'Loading…')}</div>
        <div class="watch-actions">
          <button class="action-btn" type="button" data-yt-rate title="Playback speed">${icon('gauge')} <span data-yt-rate-label>${rate}×</span></button>
          <button class="action-btn" type="button" data-yt-quality title="Video quality">${icon('hd')} <span data-yt-quality-label>${esc(quality)}</span></button>
          ${APP_MODE ? '' : `<button class="action-btn ${captions ? 'active' : ''}" type="button" data-yt-cc aria-pressed="${captions}" title="Subtitles">${icon('cc')} <span data-yt-cc-label>${captions ? 'CC On' : 'CC Off'}</span></button>`}
          <button class="action-btn" type="button" data-yt-sleep title="Sleep timer">${icon('clock')} <span data-yt-sleep-label>${(store.state.sleepTimer || 0) ? (store.state.sleepTimer + 'm') : 'Off'}</span></button>
          <button class="action-btn ${liked ? 'liked' : ''}" type="button" data-yt-like aria-pressed="${liked}">${icon('thumb-up')} <span data-yt-like-label>${liked ? 'Liked' : 'Like'}</span></button>
          <button class="action-btn ${savedYt ? 'active' : ''}" type="button" data-yt-save aria-pressed="${savedYt}">${icon(savedYt ? 'check' : 'save')} <span data-yt-save-label>${savedYt ? 'Saved' : 'Watch later'}</span></button>
          <button class="action-btn" type="button" data-yt-playlist>${icon('plus')} Playlist</button>
          <button class="action-btn action-mix" type="button" data-yt-mix title="Make a music mix from this song">${icon('shuffle')} Mix</button>
          ${APP_MODE ? `<button class="action-btn" type="button" data-yt-pip title="Picture in picture">${icon('pip')} PiP</button>` : ''}
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
          <button class="repeat-toggle ${store.repeatMode() !== 'off' ? 'active' : ''}" type="button" data-yt-repeat title="Repeat mode" aria-pressed="${store.repeatMode() !== 'off'}">${icon('refresh')} <span data-yt-repeat-label>${{ off: 'Off', one: 'One', all: 'All' }[store.repeatMode()]}</span></button>
          <button class="repeat-toggle ${store.isShuffle() ? 'active' : ''}" type="button" data-yt-shuffle title="Shuffle the queue" aria-pressed="${store.isShuffle()}">${icon('shuffle')} <span data-yt-shuffle-label>${store.isShuffle() ? 'On' : 'Off'}</span></button>
        </div>
        <div class="up-next-list" data-queue-list>${queue.map(queueItemHtml).join('')}</div>
        <p class="up-next-empty" data-queue-empty ${queue.length ? 'hidden' : ''}>Tap ${icon('plus')} on any video to line it up here.</p>
        <div class="up-next-foot">
          <button class="text-btn up-next-clear" type="button" data-queue-clear ${queue.length ? '' : 'hidden'}>Clear queue</button>
          <button class="text-btn up-next-more" type="button" data-queue-more hidden aria-expanded="false">Show more</button>
        </div>
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

  /* Account-only autoplay is scoped to videos opened from an account page.
     Opening an ordinary video clears it so related videos stay unfiltered. */
  const acctParam = new URLSearchParams(location.search).get('acct');
  if (acctParam) {
    const current = store.accountFilter();
    if (!current || current.id !== acctParam) {
      store.setAccountFilter(acctParam, meta.channel || acctParam);
    }
  } else {
    const previousAccount = store.accountFilter();
    if (previousAccount) store.clearAccountFilter();
    // Account-originated queue entries must not follow the user out of the
    // account page; otherwise Up Next stays stuck on that one channel.
    store.clearAccountQueue(previousAccount?.name || '');
  }

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

  /* Sleep timer: pause playback after N minutes. */
  const sleepBtn = root.querySelector('[data-yt-sleep]');
  const sleepLabelEl = root.querySelector('[data-yt-sleep-label]');
  const SLEEP_OPTIONS = [0, 15, 30, 45, 60];
  let sleepTimerHandle = null;
  let sleepPauseHandle = null;
  const refreshSleepLabel = () => {
    const m = Number(store.state.sleepTimer) || 0;
    if (sleepLabelEl) sleepLabelEl.textContent = m ? `${m}m` : 'Off';
  };
  const clearSleepTimer = () => {
    if (sleepTimerHandle) {
      clearInterval(sleepTimerHandle);
      sleepTimerHandle = null;
    }
    if (sleepPauseHandle) {
      clearTimeout(sleepPauseHandle);
      sleepPauseHandle = null;
    }
  };
  // The deadline is global so the timer survives navigation/autoplay; each
  // watch page re-arms its local handles from it on mount.
  const SLEEP_DEADLINE_KEY = 'dinosour.sleepDeadline';
  const sleepDeadline = () => {
    try { return Number(sessionStorage.getItem(SLEEP_DEADLINE_KEY)) || 0; } catch { return 0; }
  };
  const armSleepTimer = (minutes) => {
    clearSleepTimer();
    store.set('sleepTimer', minutes);
    refreshSleepLabel();
    if (minutes > 0) {
      // Wall-clock deadline: background WebView throttles 1s intervals, but a
      // single timeout still fires at the right time and must do the pausing.
      const deadline = Date.now() + minutes * 60 * 1000;
      try { sessionStorage.setItem(SLEEP_DEADLINE_KEY, String(deadline)); } catch {}
      const fire = () => {
        clearSleepTimer();
        store.set('sleepTimer', 0);
        refreshSleepLabel();
        try { sessionStorage.removeItem(SLEEP_DEADLINE_KEY); } catch {}
        try { mediaTarget?.pause?.(); } catch {}
        toast(`Sleep timer: paused after ${minutes} min`);
      };
      sleepPauseHandle = setTimeout(fire, minutes * 60 * 1000);
      sleepTimerHandle = setInterval(() => {
        const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 60000));
        if (sleepLabelEl) sleepLabelEl.textContent = `${remain}m`;
        if (remain <= 0) fire();
      }, 1000);
      toast(`Sleep timer set for ${minutes} min`);
    } else {
      try { sessionStorage.removeItem(SLEEP_DEADLINE_KEY); } catch {}
      toast('Sleep timer off');
    }
  };
  sleepBtn?.addEventListener('click', () => {
    const current = Number(store.state.sleepTimer) || 0;
    const idx = SLEEP_OPTIONS.indexOf(current);
    const next = SLEEP_OPTIONS[(idx + 1) % SLEEP_OPTIONS.length];
    armSleepTimer(next);
  });
  refreshSleepLabel();
  // Re-arm an in-flight timer after navigation/autoplay.
  const pendingSleep = sleepDeadline();
  if (pendingSleep > Date.now()) {
    store.set('sleepTimer', Math.max(1, Math.ceil((pendingSleep - Date.now()) / 60000)));
    refreshSleepLabel();
    const left = pendingSleep - Date.now();
    sleepPauseHandle = setTimeout(() => {
      clearSleepTimer();
      store.set('sleepTimer', 0);
      refreshSleepLabel();
      try { sessionStorage.removeItem(SLEEP_DEADLINE_KEY); } catch {}
      try { mediaTarget?.pause?.(); } catch {}
      toast('Sleep timer: paused');
    }, left);
  } else if (pendingSleep) {
    try { sessionStorage.removeItem(SLEEP_DEADLINE_KEY); } catch {}
  }

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
  // Suggested Up Next entries are not in the persisted queue, so hiding one
  // needs its own per-view set (otherwise "Remove" shows a toast but nothing
  // disappears when the queue is empty).
  const hiddenSuggested = new Set();
  const UP_NEXT_COLLAPSED = 4;
  let queueExpanded = false;
  let endTimer = null;
  let endNext = null;
  let endVisible = false;
  let endSuppressed = false;
  let playing = false;
  let reportedPlaying = false;
  let pausedByUser = false;
  let pausedAt = 0;
  let started = false;
  let wantPlaying = false;
  let lastAdvance = Date.now();
  let lastNudge = 0;
  let keepAliveTimer = null;
  let lastPlayerState = null;
  // Hidden tabs throttle/throttle the embed so its "ended" (state 0) message
  // never arrives. A wall-clock watchdog advances on time instead, so music
  // keeps playing to the next song even when the video is not on screen.
  let endWatchdog = null;
  let expectedEndAt = 0;

  const endCard = playerEl?.querySelector('[data-yt-end]');
  store.pushWatchTrail(id);

  /* Show that autoplay is locked to one account, with an easy way out. */
  const activeAccount = store.accountFilter();
  if (activeAccount) {
    const banner = document.createElement('div');
    banner.className = 'account-mode-banner';
    banner.innerHTML = `${icon('film')}<span>Account mode: only <strong>${esc(activeAccount.name)}</strong> videos will play next.</span><button type="button" data-account-off>Turn off</button>`;
    root.prepend(banner);
    banner.querySelector('[data-account-off]')?.addEventListener('click', () => {
      store.clearAccountFilter();
      banner.remove();
      toast('Account-only mode is off.');
    });
  }

  /* Tell the native media session when playback starts or stops. */
  const syncMedia = (next = playing) => {
    if (next === reportedPlaying) return;
    reportedPlaying = next;
    reportMedia(next, meta.title, meta.channel);
  };

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

  const nativePlaying = () => APP_MODE && !!window.Dinosour?.playVideo && !frame;

  /* Lock-screen and notification controls for this watch page. */
  const mediaTarget = {
    play() {
      if (!playerEl) return;
      pausedByUser = false;
      wantPlaying = true;
      lastAdvance = Date.now();
      playing = true;
      syncMedia(true);
      if (nativePlaying()) window.Dinosour.resumeVideo?.();
      else if (!playerEl.classList.contains('playing')) startPlayback();
      else send({ event: 'command', func: 'playVideo', args: [] });
    },
    pause() {
      pausedByUser = true;
      wantPlaying = false;
      pausedAt = Date.now();
      playing = false;
      syncMedia(false);
      if (nativePlaying()) window.Dinosour.pauseVideo?.();
      else send({ event: 'command', func: 'pauseVideo', args: [] });
    },
    stop() {
      pausedByUser = true;
      wantPlaying = false;
      pausedAt = Date.now();
      playing = false;
      syncMedia(false);
      if (nativePlaying()) window.Dinosour.stopPlayer?.();
      else send({ event: 'command', func: 'pauseVideo', args: [] });
    },
    next() {
      if (destroyed) return;
      playNext();
    },
  };
  setMediaTarget(mediaTarget);

  /* YouTube likes to pause a hidden embed on its own. Retrying playVideo while
     the app is backgrounded keeps audio going, but the retry is disabled in
     the foreground and after a real user/native pause, so it can never fight
     the pause button. */
  const nudgePlayback = () => {
    // Use real page visibility, not the native bridge flag — on localhost
    // isAppVisible() is always true so the old guard never let audio continue.
    if (destroyed || !frame || !isHidden() || !wantPlaying || pausedByUser) return;
    const now = Date.now();
    if (now - lastNudge < 3000 || now - lastAdvance < 3500) return;
    lastNudge = now;
    send({ event: 'command', func: 'playVideo', args: [] });
  };

  const onAppVisibility = (event) => {
    const visible = !!event.detail?.visible;
    if (visible) {
      lastNudge = 0;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      return;
    }
    if (pausedByUser || lastPlayerState === 0 || !frame) return;
    // Resume on the way out when the video was rolling (or YouTube paused it
    // just before the app was hidden). A pause that happened long ago is left
    // alone, so leaving the app does not restart a video the user paused.
    const recentlyPlaying = wantPlaying || playing || Date.now() - lastAdvance < 2500;
    if (!recentlyPlaying) return;
    wantPlaying = true;
    lastAdvance = Date.now();
    lastNudge = 0;
    if (duration) {
      expectedEndAt = Date.now() + Math.max(1000, (duration - position) * 1000);
      armEndWatchdog();
    }
    if (!keepAliveTimer) keepAliveTimer = setInterval(nudgePlayback, 2000);
    send({ event: 'command', func: 'playVideo', args: [] });
  };

  const save = (force = false) => {
    if (destroyed || !duration || !position) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    store.saveResume({ ...meta, id, t: position, d: duration });
  };

  /* Recently watched. Only real playback counts, not opening the page. */
  const remember = () => {
    if (!started) return;
    const entry = { ...meta, id, length: meta.length || (duration ? fmtDuration(duration) : '') };
    store.addYtHistory(entry);
    store.refreshYtItem(entry);
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

  /* When account-only autoplay is running low on queued videos, fetch more
     from that same channel (LibreTube's fetchMoreFromChannel pattern) so the
     queue does not dry up after the initial batch. */
  let toppingUp = false;
  const topUpAccountQueue = async () => {
    const filter = store.accountFilter();
    if (!filter || toppingUp || store.queueList().length > 2) return;
    toppingUp = true;
    try {
      const data = await searchYouTube(filter.name);
      const more = (data.videos || []).filter((v) => accountMatches(v) && v.id !== id);
      if (more.length) {
        store.addManyToQueue(more, 'account:' + filter.id);
        paintQueue();
      }
    } catch {
      /* optional improvement */
    } finally {
      toppingUp = false;
    }
  };

  const paintQueue = () => {
    const list = root.querySelector('[data-queue-list]');
    const empty = root.querySelector('[data-queue-empty]');
    const clear = root.querySelector('[data-queue-clear]');
    const more = root.querySelector('[data-queue-more]');
    const queue = store.queueList();
    // With no explicit queue, show similar videos as the suggested Up Next.
    const suggested = relatedVideos.filter((v) => v && !hiddenSuggested.has(v.id));
    const all = queue.length ? queue : suggested;
    // Up Next starts collapsed ("show less" by default); Show more reveals all.
    const collapsed = UP_NEXT_COLLAPSED;
    const shown = queueExpanded ? all : all.slice(0, collapsed);
    if (list) list.innerHTML = shown.map(queueItemHtml).join('');
    if (empty) empty.hidden = shown.length > 0;
    if (clear) clear.hidden = shown.length === 0;
    if (more) {
      more.hidden = all.length <= collapsed;
      more.textContent = queueExpanded ? 'Show less' : 'Show more';
      more.setAttribute('aria-expanded', String(queueExpanded));
    }
    if (store.accountFilter()) topUpAccountQueue();
  };

  /* Account mode keeps autoplay inside one channel (NewPipe's SinglePlayQueue
     pattern): the queue is already restricted when it was built, but we also
     guard here in case related results come from elsewhere. */
  const accountMatches = (v) => {
    const filter = store.accountFilter();
    if (!filter || !v) return true;
    const channel = String(v.channel || '').toLowerCase();
    return String(v.channelId || '') === filter.id || channel === filter.name.toLowerCase();
  };

  const nextUp = () => {
    const filter = store.accountFilter();
    const queue = store.queueList();
    if (filter) {
      // Only queued videos from this account advance automatically; the
      // related rail is still shown in full for the video the user clicked.
      const pool = store.isShuffle()
        ? shuffleArray(store.queueList().filter(accountMatches))
        : store.queueList().filter(accountMatches);
      return pool[0] || null;
    }
    const suggested = relatedVideos.filter((v) => v && !hiddenSuggested.has(v.id));
    if (store.isShuffle()) {
      const pool = store.queueList();
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
      if (suggested.length) return suggested[Math.floor(Math.random() * suggested.length)] || null;
      return null;
    }
    return store.queueList()[0] || suggested[0] || null;
  };

  const hideEndCard = () => {
    endVisible = false;
    clearInterval(endTimer);
    endTimer = null;
    endCard?.classList.remove('visible');
    const bar = endCard?.querySelector('[data-end-progress]');
    if (bar) bar.style.width = '0%';
  };

  const accountSuffix = () => {
    const filter = store.accountFilter();
    return filter ? `&acct=${encodeURIComponent(filter.id)}` : '';
  };

  const playNext = (video = nextUp()) => {
    if (!video?.id || destroyed) return;
    hideEndCard();
    store.pushWatchTrail(id);
    store.removeFromQueue(video.id);
    // Repeat all: rotate the FINISHED video back to the end of the queue so
    // the list cycles instead of ending after one pass (NewPipe/LibreTube).
    if (store.repeatMode() === 'all') {
      store.addToQueue({
        id,
        title: meta.title,
        channel: meta.channel,
        thumb: meta.thumb,
        length: meta.length || '',
      });
    }
    save(true);
    navigate(`/watch/yt/${encodeURIComponent(video.id)}?autoplay=1${accountSuffix()}`);
  };

  const playPrevious = () => {
    if (destroyed) return;
    // The current page pushed its own id on mount; skip it to find the real
    // predecessor. The trail lives in the store so it survives re-mounts.
    let prevId = null;
    for (let i = 0; i < 4; i++) {
      const candidate = store.popWatchTrail();
      if (!candidate) break;
      if (candidate !== id) {
        prevId = candidate;
        break;
      }
    }
    if (!prevId) {
      toast('Nothing to go back to.');
      return;
    }
    hideEndCard();
    save(true);
    const suffix = store.accountFilter() ? `&acct=${encodeURIComponent(store.accountFilter().id)}` : '';
    navigate(`/watch/yt/${encodeURIComponent(prevId)}?autoplay=1${suffix}`);
  };

  const replay = () => {
    hideEndCard();
    endSuppressed = false;
    wantPlaying = true;
    lastAdvance = Date.now();
    store.removeResume(id);
    seekTo(0, false);
    send({ event: 'command', func: 'playVideo', args: [] });
  };

  const showEndCard = (force = false) => {
    if (!endCard || destroyed) return;
    // Settings can change while the card is visible; rebuild it instead of
    // early-returning so a stale countdown/next target is never left running.
    if (force) {
      clearInterval(endTimer);
      endTimer = null;
      endVisible = false;
      endSuppressed = false;
    }
    if (endVisible || endSuppressed) return;
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
    const prevBtn = endCard.querySelector('[data-end-act="prev"]');
    const next = nextUp();
    endNext = next;
    // Repeat-one and "nothing left" branches do not repaint this row; clear it
    // here so thumbnails from a previous end card never linger.
    const alsoElEarly = endCard.querySelector('[data-end-related]');
    if (alsoElEarly) alsoElEarly.innerHTML = '';

    // Repeat one: show this video as "up next" and replay when the countdown
    // finishes, instead of moving to another video.
    if (store.repeatMode() === 'one') {
      label.textContent = 'Repeat one';
      title.textContent = meta.title;
      sub.textContent = meta.channel || 'YouTube';
      thumb.src = meta.thumb;
      thumb.alt = '';
      links.forEach((a) => {
        a.href = `/watch/yt/${encodeURIComponent(id)}?autoplay=1${accountSuffix()}`;
      });
      play.hidden = true;
      replayBtn.hidden = false;
      if (store.state.autoplay) {
        const total = 8000;
        const started = Date.now();
        clearInterval(endTimer);
        endTimer = setInterval(() => {
          const left = total - (Date.now() - started);
          count.textContent = `Replay in ${Math.max(0, Math.ceil(left / 1000))}`;
          bar.style.width = `${Math.min(100, Math.max(0, 100 - (left / total) * 100))}%`;
          if (left <= 0) {
            clearInterval(endTimer);
            replay();
          }
        }, 200);
      } else {
        count.textContent = 'Autoplay is off';
        bar.style.width = '0%';
      }
      return;
    }

    // "Also next": whatever is queued, then the related rail, without repeats.
    const also = [...store.queueList(), ...relatedVideos]
      .filter((v) => v.id !== id && v.id !== next?.id && !hiddenSuggested.has(v.id))
      .filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i)
      .slice(0, 3);
    const alsoEl = endCard.querySelector('[data-end-related]');
    if (alsoEl) alsoEl.innerHTML = also.map((v) => ytEndItemHtml(v, accountSuffix())).join('');

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
      a.href = `/watch/yt/${encodeURIComponent(next.id)}?autoplay=1${accountSuffix()}`;
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
      if (!meta.length) {
        meta.length = fmtDuration(duration);
        remember();
      }
    } else {
      const seconds = Number(info.videoData?.videoDetails?.lengthSeconds);
      if (Number.isFinite(seconds) && seconds > 0) duration = seconds;
    }

    if (typeof info.currentTime === 'number') {
      // Some embeds omit playerState, so advancing time also means "playing".
      // Never re-send a pause here: YouTube can report a stale tick right after
      // a resume, and repeating the command used to pause the video forever.
      const advancing = info.currentTime > position + 0.05;
      if (advancing && !pausedByUser) {
        playing = true;
        wantPlaying = true;
        lastAdvance = Date.now();
      }
      position = info.currentTime;
      // Don't wait for playerState: several videos omit it from infoDelivery.
      if (duration) {
        // Refresh the hidden-tab end estimate from real playback progress.
        if (wantPlaying && !pausedByUser) {
          expectedEndAt = Date.now() + Math.max(1000, (duration - position) * 1000);
        }
        maybeSeek();
        if (position >= duration - 2) store.removeResume(id);
        else if (position > 4) save();
      }
    }

    const state = typeof info.playerState === 'number' ? info.playerState : null;
    if (state !== null) lastPlayerState = state;
    if (state === 1) {
      // Playing again — either the user resumed inside the embed or playback
      // recovered on its own.
      pausedByUser = false;
      playing = true;
      wantPlaying = true;
      lastAdvance = Date.now();
      if (isHidden() && duration) {
        expectedEndAt = Date.now() + Math.max(1000, (duration - position) * 1000);
        armEndWatchdog();
      }
    } else if (state === 0 || state === 2) {
      playing = false;
      if (state === 0) {
      wantPlaying = false;
      expectedEndAt = 0;
      if (endWatchdog) {
        clearInterval(endWatchdog);
        endWatchdog = null;
      }
    }
      else if (isHidden()) {
        // YouTube auto-paused a hidden embed. Keep wanting playback so the
        // nudge can restore audio — unless the user explicitly paused.
        if (wantPlaying && !pausedByUser) lastAdvance = 0;
      } else {
        // Paused in the foreground: the user pressed pause in the player.
        // Latch it, otherwise switching tabs later looks like a fresh chance
        // to resume and the video starts playing by itself.
        pausedByUser = true;
        wantPlaying = false;
        if (endWatchdog) {
          clearInterval(endWatchdog);
          endWatchdog = null;
        }
        expectedEndAt = 0;
      }
    }

    if (state === 2) save(true);
    else if (state === 0) {
      store.removeResume(id);
      if (isHidden() && !endSuppressed && !pausedByUser) {
        // Hidden tabs throttle the end-card countdown to a crawl, so skip it
        // and advance immediately from the real "ended" event.
        if (endWatchdog) {
          clearInterval(endWatchdog);
          endWatchdog = null;
        }
        expectedEndAt = 0;
        const next = nextUp();
        if (next) playNext(next);
        else showEndCard();
      } else {
        showEndCard();
      }
    } else if (state === 1 || state === 3) {
      endSuppressed = false;
    }

    syncMedia();
  };

  /* Ask the player to report its clock. A few retries covers slow loads. */
  const listen = () => {
    if (destroyed || !frame) return;
    send({ event: 'listening', id: `dinosour-${id}` });
    listenTries += 1;
    listenTimer = listenTries < 8 ? setTimeout(listen, 1200) : null;
  };

  const isHidden = () => document.visibilityState === 'hidden' || !isAppVisible();

  /* If the player stops reporting state while hidden, advance from the clock.
     position/duration come from the last embed message, so expectedEndAt is
     refreshed whenever the embed reports fresh time. */
  const armEndWatchdog = () => {
    if (endWatchdog) clearInterval(endWatchdog);
    endWatchdog = setInterval(() => {
      if (destroyed || endSuppressed || pausedByUser || !wantPlaying) return;
      if (!expectedEndAt || Date.now() < expectedEndAt) return;
      // The wall clock is authoritative even when the hidden tab throttles
      // timers and the embed never reports its "ended" event.
      if (endVisible) return; // foreground end card is already handling it
      if (store.repeatMode() === 'one') {
        replay();
        return;
      }
      const next = nextUp();
      if (next) playNext(next);
      else expectedEndAt = 0;
    }, 1000);
  };

  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      save(true);
      if (wantPlaying && !pausedByUser) {
        // Duration from the embed may be missing in a hidden tab; fall back to
        // the length shown on the watch page so the end timer still arms.
        const total = duration || parseLength(meta.length);
        const left = total ? Math.max(1000, (total - position) * 1000) : 0;
        if (left) {
          expectedEndAt = Date.now() + left;
          armEndWatchdog();
        }
        // Keep audio alive in a real background browser tab too.
        lastNudge = 0;
        if (!keepAliveTimer) keepAliveTimer = setInterval(nudgePlayback, 2000);
        if (frame) send({ event: 'command', func: 'playVideo', args: [] });
      }
    } else if (endWatchdog) {
      clearInterval(endWatchdog);
      endWatchdog = null;
      expectedEndAt = 0;
    }
  };

  const onPageHide = () => save(true);

  const destroy = () => {
    if (destroyed) return;
    save(true);
    destroyed = true;
    wantPlaying = false;
    window.removeEventListener('message', onMessage);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('dinosour:appvisibility', onAppVisibility);
    if (window.__dinosourNativeFailed === onNativeFailed) {
      delete window.__dinosourNativeFailed;
    }
    clearTimeout(listenTimer);
    clearTimeout(seekTimer);
    clearInterval(endTimer);
    if (endWatchdog) clearInterval(endWatchdog);
    // Keep the sleep timer alive across navigation (e.g. autoplay); only the
    // page's local handles are cleared, the global deadline is re-armed on the
    // next watch page or by the mini player.
    clearSleepTimer();
    clearInterval(keepAliveTimer);
    root.removeEventListener('click', onWatchClick);
    clearMediaTarget(mediaTarget);
    send({ event: 'command', func: 'pauseVideo', args: [] });
    frame = null;
    playing = false;
  };

  /* Leaving while the video is rolling: the app turns this into a mini player. */
  const handOff = () => {
    if (destroyed || !playing) return null;
    // The native player owns playback in the app; no mini iframe needed.
    if (APP_MODE && window.Dinosour?.playVideo) return null;
    if (!frame) return null;
    return {
      id,
      title: meta.title,
      channel: meta.channel,
      thumb: meta.thumb,
      position,
      duration,
    };
  };

  window.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('dinosour:appvisibility', onAppVisibility);
  if (!isAppVisible()) keepAliveTimer = setInterval(nudgePlayback, 2000);

  const startEmbed = () => {
    if (!playerEl) return;
    frame = document.createElement('iframe');
    frame.className = 'yt-frame';
    const startParam =
      saved && saved.t >= 4 && (!saved.d || saved.t < saved.d - 6) ? `&start=${Math.floor(saved.t)}` : '';
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&color=white&enablejsapi=1&cc_load_policy=${store.captionsEnabled() ? 1 : 3}${startParam}${APP_MODE ? '' : `&origin=${encodeURIComponent(location.origin)}`}`;
    frame.title = root.querySelector('[data-yt-title]')?.textContent || 'YouTube video';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    playerEl.replaceChildren(frame);
    // keep the end screen mounted above the iframe
    if (endCard) playerEl.append(endCard);
    playerEl.classList.add('playing');
    started = true;
    remember();
    frame.addEventListener('load', () => {
      listenTries = 0;
      listen();
    });
  };

  const startPlayback = () => {
    if (!playerEl || playerEl.classList.contains('playing')) return;
    pausedByUser = false;
    wantPlaying = true;
    lastAdvance = Date.now();
    // In the Android app, the native ExoPlayer surface replaces the embed so
    // background playback actually works.
    if (APP_MODE && window.Dinosour?.playVideo) {
      playerEl.replaceChildren();
      // replaceChildren() detaches the end screen; keep it mounted so native
      // playback still gets the end card and autoplay.
      if (endCard) playerEl.append(endCard);
      playerEl.classList.add('playing');
      started = true;
      remember();
      // The native media session needs this to publish the title and expose
      // lock-screen controls for the primary (ExoPlayer) playback path.
      syncMedia(true);
      try {
        window.Dinosour.playVideo(id);
      } catch {
        startEmbed();
      }
      return;
    }
    startEmbed();
  };

  /* The native extractor can fail when YouTube changes its signatures or
     anti-bot checks. The Java side calls back here and we quietly switch to
     the regular embed, so a video tap never leaves a dead player. */
  const onNativeFailed = () => {
    if (destroyed || !APP_MODE || !window.Dinosour?.playVideo) return;
    if (!playerEl?.classList.contains('playing')) return;
    try {
      window.Dinosour.stopPlayer?.();
    } catch {
      /* bridge unavailable */
    }
    playerEl.classList.remove('playing');
    started = false;
    frame = null;
    startEmbed();
    toast('Using the web player for this video.');
  };
  window.__dinosourNativeFailed = onNativeFailed;

  playBtn?.addEventListener('click', startPlayback);
  root.querySelector('[data-yt-pip]')?.addEventListener('click', () => {
    try {
      if (window.Dinosour?.pipVideo) window.Dinosour.pipVideo();
      else toast('Picture in picture is only available in the Android app.');
    } catch {
      toast('Picture in picture is unavailable right now.');
    }
  });
  root.querySelector('[data-copy-remote]')?.addEventListener('click', () => copyLink());
  root.querySelector('[data-yt-mix]')?.addEventListener('click', async () => {
    const button = root.querySelector('[data-yt-mix]');
    button?.setAttribute('disabled', '');
    try {
      const seed = { ...meta, id };
      let topic = '';
      try {
        topic = sessionStorage.getItem('dinosour.lastQuery') || '';
      } catch {
        /* storage may be unavailable */
      }
      let tracks = relatedVideos.length ? relatedVideos : [];
      if (!tracks.length) {
        tracks = await buildMix(seed, searchYouTube, { count: 20, topic }).catch(async () => {
          const fallback = await searchYouTube(String(meta.title || '').split('|')[0].trim());
          return fallback.videos || [];
        });
      }
      tracks = dedupeTracks(tracks, seed.title, 20, 1, seed);
      // The seed song belongs in its own mix, as the first track.
      tracks = withSeedTrack(tracks, seed);
      if (!tracks.length) {
        toast('Could not build a mix right now. Check your connection.');
        button?.removeAttribute('disabled');
        return;
      }
      store.saveMix({ id, seed, tracks, topic });
      toast(`Mix created from ${tracks.length} songs`);
      navigate(`/mix/${encodeURIComponent(id)}`);
    } catch {
      toast('Could not build a mix right now.');
      button?.removeAttribute('disabled');
    }
  });

  // This video is playing now, so it no longer waits in Up Next.
  store.removeFromQueue(id);
  store.resetNextCursor();
  paintQueue();

  const onWatchClick = (event) => {
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
      const removedId = remove.dataset.queueRemove;
      store.removeFromQueue(removedId);
      // Always hide it from the suggested fallback too, otherwise removing a
      // queued copy immediately re-exposes the same video as a suggestion.
      hiddenSuggested.add(removedId);
      paintQueue();
      toast('Removed from Up Next');
      return;
    }

    if (event.target.closest('[data-queue-clear]')) {
      store.clearQueue();
      for (const v of relatedVideos) if (v?.id) hiddenSuggested.add(v.id);
      paintQueue();
      toast('Up Next cleared');
      return;
    }

    if (event.target.closest('[data-queue-more]')) {
      queueExpanded = !queueExpanded;
      paintQueue();
    }
  };
  root.addEventListener('click', onWatchClick);

  root.querySelector('[data-yt-autoplay]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const on = !store.state.autoplay;
    store.set('autoplay', on);
    button.setAttribute('aria-pressed', String(on));
    button.querySelector('.switch')?.classList.toggle('on', on);
    // A running countdown must stop/resume immediately when the toggle changes.
    if (!on) hideEndCard();
    else if (endVisible || endSuppressed) showEndCard(true);
    toast(on ? 'Autoplay on' : 'Autoplay off');
  });

  root.querySelector('[data-yt-repeat]')?.addEventListener('click', (event) => {
    const mode = store.cycleRepeat();
    const button = event.currentTarget;
    button.classList.toggle('active', mode !== 'off');
    button.setAttribute('aria-pressed', String(mode !== 'off'));
    const label = root.querySelector('[data-yt-repeat-label]');
    if (label) label.textContent = { off: 'Off', one: 'One', all: 'All' }[mode];
    if (endVisible) showEndCard(true);
    toast({ off: 'Repeat off', one: 'Repeat this video', all: 'Repeat the queue' }[mode]);
  });

  root.querySelector('[data-yt-shuffle]')?.addEventListener('click', (event) => {
    const on = store.toggleShuffle();
    const button = event.currentTarget;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
    const label = root.querySelector('[data-yt-shuffle-label]');
    if (label) label.textContent = on ? 'On' : 'Off';
    toast(on ? 'Shuffle on' : 'Shuffle off');
  });

  endCard?.addEventListener('click', (event) => {
    const act = event.target.closest('[data-end-act]')?.dataset.endAct;
    if (act === 'prev') playPrevious();
    else if (act === 'play') playNext(endNext);
    else if (act === 'replay') replay();
    else if (act === 'cancel') {
      endSuppressed = true;
      hideEndCard();
    }
  });

  paintPrefs();

  const likeBtn = root.querySelector('[data-yt-like]');
  likeBtn?.addEventListener('click', () => {
    const on = store.toggleYtLike({ ...meta, id, length: meta.length || '' });
    likeBtn.classList.toggle('liked', on);
    likeBtn.setAttribute('aria-pressed', String(on));
    const label = root.querySelector('[data-yt-like-label]');
    if (label) label.textContent = on ? 'Liked' : 'Like';
    toast(on ? 'Added to Liked videos' : 'Removed from Liked videos');
  });

  const saveBtn = root.querySelector('[data-yt-save]');
  saveBtn?.addEventListener('click', () => {
    const on = store.toggleYtSave({ ...meta, id, length: meta.length || '' });
    saveBtn.classList.toggle('active', on);
    saveBtn.setAttribute('aria-pressed', String(on));
    saveBtn.innerHTML = `${icon(on ? 'check' : 'save')} <span data-yt-save-label>${on ? 'Saved' : 'Watch later'}</span>`;
    toast(on ? 'Saved to Watch later' : 'Removed from Watch later');
  });

  root.querySelector('[data-yt-playlist]')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const current = { ...meta, id, length: meta.length || '' };
    const items = store.playlistsList().map((playlist) => ({
      key: `playlist-${playlist.id}`,
      icon: store.inPlaylist(playlist.id, id) ? 'check' : 'plus',
      label: `${store.inPlaylist(playlist.id, id) ? 'Remove from' : 'Add to'} ${playlist.name}`,
      onClick: () => {
        if (store.inPlaylist(playlist.id, id)) {
          store.removeFromPlaylist(playlist.id, id);
          toast(`Removed from ${playlist.name}`);
        } else {
          store.addToPlaylist(playlist.id, current);
          toast(`Added to ${playlist.name}`);
        }
      },
    }));
    if (items.length) items.push({ sep: true });
    items.push({
      key: 'new-playlist',
      icon: 'plus',
      label: 'New playlist…',
      onClick: () => {
        openPrompt({
          title: 'New playlist',
          label: 'Playlist name',
          placeholder: 'Music, Watch later, Road trip…',
          confirmText: 'Create',
          onSubmit: (name) => {
            const playlist = store.createPlaylist(name);
            if (!playlist) {
              toast('A playlist with that name already exists');
              return;
            }
            store.addToPlaylist(playlist.id, current);
            toast(`Created “${playlist.name}” and added this video`);
          },
        });
      },
    });
    openMenu(button, items);
  });

  rateBtn?.addEventListener('click', () => {
    const current = currentRate();
    openMenu(
      rateBtn,
      YT_RATES.map((rate) => ({
        key: `rate-${rate}`,
        label: rate === 1 ? 'Normal (1×)' : `${rate}×`,
        checked: current === rate,
        onClick: () => {
          if (nativePlaying()) {
            toast('Playback speed is not available in the native player.');
            return;
          }
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
          if (nativePlaying()) {
            toast('Quality is controlled by the native player.');
            return;
          }
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

  const captionsBtn = root.querySelector('[data-yt-cc]');
  const captionsLabel = root.querySelector('[data-yt-cc-label]');
  captionsBtn?.addEventListener('click', () => {
    const next = !store.captionsEnabled();
    store.setCaptions(next);
    captionsBtn?.classList.toggle('active', next);
    captionsBtn?.setAttribute('aria-pressed', String(next));
    if (captionsLabel) captionsLabel.textContent = next ? 'CC On' : 'CC Off';
    // cc_load_policy 1 forces captions on, 3 forces them off; reload the
    // embed so the new policy takes effect.
    if (frame) {
      frame.src =
        `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&color=white&enablejsapi=1&cc_load_policy=${next ? 1 : 3}` +
        (position >= 4 && (!duration || position < duration - 6) ? `&start=${Math.floor(position)}` : '') +
        (APP_MODE ? '' : `&origin=${encodeURIComponent(location.origin)}`);
    }
    toast(next ? 'Subtitles on' : 'Subtitles off');
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
      const chRow = root.querySelector('[data-yt-channel-row]');
      if (chRow && meta.channel) {
        const accId = info.channelId || meta.channel;
        const href = `/channel/${encodeURIComponent(accId)}?yt=1&name=${encodeURIComponent(meta.channel)}`;
        chRow.innerHTML = `<a class="watch-channel-link account-link" href="${href}" data-link title="See all ${esc(meta.channel)} videos">${avatar({ name: meta.channel, color: colorFor(meta.channel) })}<span>${esc(meta.channel)}</span></a>`;
      }
      const titleEl = root.querySelector('[data-yt-title]');
      if (titleEl) titleEl.textContent = info.title;
      document.title = `${info.title} — dinosour`;
      remember();

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

    // Build a varied mix in the same style: search several related queries
    // instead of the full title, which used to return the same song from every
    // lyric channel. Deduplication keeps one upload per track.
    const titleSeed = String(meta.title || '').replace(/\s*\|.*$/, '').trim();
    let searchedTopic = '';
    try {
      searchedTopic = sessionStorage.getItem('dinosour.lastQuery') || '';
    } catch {
      /* storage may be unavailable */
    }
    if (!titleSeed && !searchedTopic) {
      relatedEl.innerHTML = '<p class="related-empty">No related videos found.</p>';
      return;
    }

    try {
      const videos = await buildMix(
        { title: titleSeed, id, channel: meta.channel },
        searchYouTube,
        { count: 12, topic: searchedTopic }
      );
      if (destroyed || !playerEl?.isConnected) return;
      // Related videos stay normal — account mode only restricts autoplay.
      relatedVideos = videos;
      paintQueue();
      relatedEl.innerHTML = videos.length
        ? videos.map(ytRelItemHtml).join('')
        : '<p class="related-empty">No related videos found.</p>';
    } catch {
      if (playerEl?.isConnected) {
        relatedEl.innerHTML = '<p class="related-empty">Related videos are unavailable right now.</p>';
      }
    }
  })();

  return { destroy, handOff };
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

export function renderLibrary(kind, playlistId = '') {
  if (kind === 'playlists') return renderPlaylistsPage();
  if (kind === 'playlist') return renderPlaylistPage(playlistId);
  if (kind === 'history') return renderHistory();
  if (kind === 'liked') return renderGridPage('liked');
  return renderGridPage('watch-later');
}

function libraryTabs(active) {
  const tabs = [
    ['history', 'History', '/feed/history'],
    ['watch-later', 'Watch later', '/feed/watch-later'],
    ['liked', 'Liked', '/feed/liked'],
    ['playlists', 'Playlists', '/feed/playlists'],
  ];
  return `<nav class="library-tabs" aria-label="Library">${tabs
    .map(
      ([key, label, href]) =>
        `<a class="library-tab${key === active ? ' active' : ''}" href="${href}" data-link>${label}</a>`
    )
    .join('')}</nav>`;
}

function ytHistoryRowHtml(v) {
  return `<div class="history-row" data-yt-history-id="${esc(v.id)}">
    <a href="/watch/yt/${encodeURIComponent(v.id)}" data-link class="thumb">
      <img src="${esc(v.thumb)}" alt="" loading="lazy">
      ${v.length ? `<span class="duration">${esc(v.length)}</span>` : ''}
    </a>
    <a href="/watch/yt/${encodeURIComponent(v.id)}" data-link class="history-info">
      <div class="history-title">${esc(v.title)}</div>
      <div class="history-sub">${esc(v.channel || 'YouTube')}</div>
      <div class="history-sub">Watched ${timeAgo(new Date(v.at || Date.now()).toISOString())}</div>
    </a>
    <button class="icon-btn" data-remove-yt-history="${esc(v.id)}" aria-label="Remove from history">${icon('x')}</button>
  </div>`;
}

function renderHistory() {
  const ytRows = store.ytHistoryList();
  const rows = store.state.history
    .map((h) => ({ video: videoById(h.id), at: h.at }))
    .filter((x) => x.video);

  if (!ytRows.length && !rows.length) {
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
    ${ytRows.length ? `<div data-yt-history-list>${ytRows.map(ytHistoryRowHtml).join('')}</div>` : ''}
    ${
      rows.length
        ? `<h2 class="library-subhead">From the film library</h2>
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
          </div>`
        : ''
    }
  </div>`;
}

function renderGridPage(kind) {
  const ids = kind === 'liked' ? store.likedIds() : store.savedIds();
  const videos = ids.map((id) => videoById(id)).filter(Boolean);
  const ytVideos = kind === 'liked' ? store.ytLikedList() : store.ytSavedList();
  const total = ytVideos.length + videos.length;
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
  const removeAttr = kind === 'liked' ? 'data-remove-yt-liked' : 'data-remove-yt-saved';
  const removeButton = (v) =>
    `<button class="icon-btn card-remove" type="button" ${removeAttr}="${esc(v.id)}" aria-label="Remove from ${meta.title}" title="Remove">${icon('x')}</button>`;

  if (!total) {
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
      <span class="page-count">${total} video${total === 1 ? '' : 's'}</span>
    </div>
    <div class="grid">${ytVideos.map((v) => ytCardHtml(v, removeButton(v))).join('')}${videos
      .map(cardHtml)
      .join('')}</div>`;
}

function renderPlaylistsPage() {
  const playlists = store.playlistsList();
  const head = `<div class="page-head">
      <h1>${icon('music')} Playlists</h1>
      <span class="spacer"></span>
      <button class="action-btn" data-new-playlist>${icon('plus')} New playlist</button>
    </div>`;

  if (!playlists.length) {
    return `<div class="page">${libraryTabs('playlists')}${head}${emptyState({
      iconName: 'music',
      title: 'No playlists yet',
      text: 'Make your own lists — Music, Road trip, anything. They stay on this device.',
      actionHref: '/',
      actionText: 'Browse videos',
    })}</div>`;
  }

  return `<div class="page">${libraryTabs('playlists')}${head}
    <div class="playlist-grid">
      ${playlists
        .map((p) => {
          const items = Array.isArray(p.items) ? p.items : [];
          const cover = items[0]?.thumb;
          return `<a class="playlist-card" href="/feed/playlist/${encodeURIComponent(p.id)}" data-link>
            <span class="playlist-cover"${cover ? ` style="background-image:url('${esc(cover)}')"` : ''}>
              ${cover ? '' : icon('music')}
              <span class="playlist-count">${items.length}</span>
            </span>
            <span class="playlist-name">${esc(p.name)}</span>
            <span class="playlist-sub">${items.length} video${items.length === 1 ? '' : 's'}</span>
          </a>`;
        })
        .join('')}
    </div>
  </div>`;
}

function renderPlaylistPage(playlistId) {
  const playlist = store.playlistById(playlistId);
  if (!playlist) {
    return `<div class="page">${libraryTabs('playlists')}${emptyState({
      iconName: 'music',
      title: 'Playlist not found',
      text: 'It may have been deleted.',
      actionHref: '/feed/playlists',
      actionText: 'Back to playlists',
    })}</div>`;
  }

  const items = Array.isArray(playlist.items) ? playlist.items : [];
  const removeButton = (v) =>
    `<button class="icon-btn card-remove" type="button" data-playlist-remove="${esc(v.id)}" data-playlist-id="${esc(
      playlist.id
    )}" aria-label="Remove from ${esc(playlist.name)}" title="Remove">${icon('x')}</button>`;

  return `<div class="page">${libraryTabs('playlists')}
    <div class="page-head">
      <a class="icon-btn" href="/feed/playlists" data-link aria-label="Back to playlists">${icon('arrow-left')}</a>
      <h1>${icon('music')} ${esc(playlist.name)}</h1>
      <span class="spacer"></span>
      <span class="page-count">${items.length} video${items.length === 1 ? '' : 's'}</span>
      <button class="action-btn" data-delete-playlist="${esc(playlist.id)}">${icon('trash')} Delete</button>
    </div>
    ${
      items.length
        ? `<div class="grid">${items.map((v) => ytCardHtml(v, removeButton(v))).join('')}</div>`
        : emptyState({
            iconName: 'music',
            title: 'This playlist is empty',
            text: 'Open any YouTube video and choose Playlist to add it.',
            actionHref: '/',
            actionText: 'Browse videos',
          })
    }
  </div>`;
}

export function mountLibrary(root, kind, playlistId = '') {
  const rerender = () => window.dispatchEvent(new PopStateEvent('popstate'));

  const createPlaylist = () => {
    openPrompt({
      title: 'New playlist',
      label: 'Playlist name',
      placeholder: 'Music, Road trip, Watch later…',
      confirmText: 'Create',
      onSubmit: (name) => {
        const playlist = store.createPlaylist(name);
        if (!playlist) {
          toast('A playlist with that name already exists');
          return;
        }
        toast(`Created “${playlist.name}”`);
        navigate(`/feed/playlist/${encodeURIComponent(playlist.id)}`);
      },
    });
  };

  root.querySelector('[data-new-playlist]')?.addEventListener('click', createPlaylist);

  const clear = root.querySelector('[data-clear-history]');
  clear?.addEventListener('click', () => {
    openMenu(clear, [
      {
        key: 'clear',
        icon: 'trash',
        label: 'Clear all watch history',
        onClick: () => {
          store.clearYtHistory();
          store.clearHistory();
          store.clearResume();
          toast('Watch history cleared');
          rerender();
        },
      },
    ]);
  });

  const deleteBtn = root.querySelector('[data-delete-playlist]');
  deleteBtn?.addEventListener('click', () => {
    const id = deleteBtn.dataset.deletePlaylist;
    const playlist = store.playlistById(id);
    openMenu(deleteBtn, [
      {
        key: 'delete',
        icon: 'trash',
        label: `Delete “${playlist?.name || 'playlist'}”`,
        onClick: () => {
          store.deletePlaylist(id);
          toast('Playlist deleted');
          navigate('/feed/playlists', { replace: true });
        },
      },
    ]);
  });

  const onClick = (event) => {
    const ytHistory = event.target.closest('[data-remove-yt-history]');
    if (ytHistory) {
      event.preventDefault();
      event.stopPropagation();
      store.removeYtHistory(ytHistory.dataset.removeYtHistory);
      store.removeResume(ytHistory.dataset.removeYtHistory);
      ytHistory.closest('.history-row')?.remove();
      toast('Removed from history');
      if (!root.querySelector('.history-row')) rerender();
      return;
    }

    const localHistory = event.target.closest('[data-remove-history]');
    if (localHistory) {
      event.preventDefault();
      event.stopPropagation();
      store.removeHistory(localHistory.dataset.removeHistory);
      localHistory.closest('.history-row')?.remove();
      toast('Removed from history');
      if (!root.querySelector('.history-row')) rerender();
      return;
    }

    const liked = event.target.closest('[data-remove-yt-liked]');
    if (liked) {
      event.preventDefault();
      event.stopPropagation();
      const item = store.ytLikedList().find((v) => v.id === liked.dataset.removeYtLiked);
      if (item) store.toggleYtLike(item);
      toast('Removed from Liked videos');
      rerender();
      return;
    }

    const saved = event.target.closest('[data-remove-yt-saved]');
    if (saved) {
      event.preventDefault();
      event.stopPropagation();
      const item = store.ytSavedList().find((v) => v.id === saved.dataset.removeYtSaved);
      if (item) store.toggleYtSave(item);
      toast('Removed from Watch later');
      rerender();
      return;
    }

    const playlistRemove = event.target.closest('[data-playlist-remove]');
    if (playlistRemove) {
      event.preventDefault();
      event.stopPropagation();
      store.removeFromPlaylist(playlistRemove.dataset.playlistId, playlistRemove.dataset.playlistRemove);
      toast('Removed from playlist');
      rerender();
    }
  };
  // #view is reused by the router; without cleanup every library visit stacks
  // another click handler, so one removal fires N times.
  if (root.__feedCleanup) root.__feedCleanup();
  root.__feedCleanup = () => root.removeEventListener('click', onClick);
  root.addEventListener('click', onClick);

  void kind;
  void playlistId;
  return {};
}

/* ============================================================ trending */

const TREND_PERIODS = [
  ['today', 'Today'],
  ['week', '1 week'],
  ['month', 'Last month'],
  ['all', 'All time'],
];
const TREND_PERIOD_DAYS = { today: 1, week: 7, month: 31, all: Infinity };

/** "3 days ago" / "2 weeks ago" -> approximate age in days. */
function publishedAgeDays(label) {
  const s = String(label || '').toLowerCase();
  if (!s || s.includes('premier')) return null;
  if (/\b(just now|now)\b/.test(s)) return 0;
  const n = Number(s.match(/[\d,.]+/)?.[0]?.replace(/,/g, '')) || 0;
  if (/\b(second|minute|hour)\b/.test(s)) return 0;
  if (/\bday\b/.test(s)) return n;
  if (/\bweek\b/.test(s)) return n * 7;
  if (/\bmonth\b/.test(s)) return n * 30;
  if (/\byear\b/.test(s)) return n * 365;
  return null;
}

/** "1.2M views" -> 1200000, for sorting each section by popularity. */
function parseViews(label) {
  const s = String(label || '').toLowerCase().replace(/,/g, '');
  const m = s.match(/([\d.]+)\s*([kmb])?/);
  if (!m) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2] || ''] || 1;
  return Number(m[1]) * mult;
}

function trendTopicsHtml(category) {
  const topics = store.trendingTopicsFor(category);
  return `${topics
    .map(
      (t) => `<span class="trend-topic">${esc(t)}<button type="button" class="trend-topic-x" data-trend-remove="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`
    )
    .join('')}<button type="button" class="trend-topic-add" data-trend-topic-add="${esc(category)}">${icon('plus')} Add topic</button>`;
}

function trendSectionHtml(category, hidden = false) {
  return `<section class="trend-section" data-trend-section="${esc(category)}" ${hidden ? 'hidden' : ''}>
    <div class="trend-section-head">
      <h2>${icon('flame')} ${esc(category)}</h2>
      <div class="trend-section-topics" data-trend-topic-list="${esc(category)}">${trendTopicsHtml(category)}</div>
    </div>
    <div class="trend-grid" data-trend-grid="${esc(category)}"></div>
    <div class="trend-more-wrap"><button type="button" class="btn-outline" data-trend-more="${esc(category)}" hidden>Load more</button></div>
  </section>`;
}

function trendEmpty(category, failed = false) {
  return `<div class="trend-empty">
    <p>${failed ? `No videos found for ${esc(category)} right now.` : `Add a topic to see what is trending in ${esc(category)}.`}</p>
    <button type="button" class="btn-outline" data-trend-topic-add="${esc(category)}">${icon('plus')} Add topic</button>
  </div>`;
}

export function renderTrending({ period, category, sort } = {}) {
  const prefs = store.trendingPref();
  const selectedPeriod = TREND_PERIODS.some(([key]) => key === period) ? period : prefs.period;
  const categories = store.trendingCategoryNames();
  const requestedCategory = category || prefs.category;
  const selectedCategory = categories.includes(requestedCategory) ? requestedCategory : 'All';
  const selectedSort = sort === 'newest' || sort === 'views' ? sort : prefs.sort;

  return `<div class="trending-page">
    <div class="trend-toolbar">
      <div class="trend-toolbar-top">
        <h1>${icon('flame')} Trending</h1>
        <div class="trend-periods" role="group" aria-label="Time period">
          ${TREND_PERIODS.map(
            ([key, label]) =>
              `<button type="button" class="trend-period ${key === selectedPeriod ? 'active' : ''}" data-period="${key}" aria-pressed="${key === selectedPeriod}">${label}</button>`
          ).join('')}
        </div>
        <div class="trend-sorts" role="group" aria-label="Sort by">
          <button type="button" class="trend-sort ${selectedSort === 'views' ? 'active' : ''}" data-sort="views">Most viewed</button>
          <button type="button" class="trend-sort ${selectedSort === 'newest' ? 'active' : ''}" data-sort="newest">Newest</button>
        </div>
        <button type="button" class="trend-refresh" data-trend-refresh title="Refresh trending" aria-label="Refresh">${icon('refresh')}</button>
      </div>
      <div class="trend-tabs" role="tablist" aria-label="Trending categories">
        ${['All', ...categories]
          .map(
            (c) =>
              `<button type="button" class="chip ${c === selectedCategory ? 'active' : ''}" data-trend-cat="${esc(c)}" role="tab" aria-selected="${c === selectedCategory}">${esc(c)}</button>`
          )
          .join('')}
        <button type="button" class="chip chip-add" data-trend-cat-add aria-label="Add a category">${icon('plus')} Category</button>
      </div>
    </div>
    <div class="trend-sections" data-trend-sections>
      ${categories
        .map((c) => trendSectionHtml(c, selectedCategory !== 'All' && c !== selectedCategory))
        .join('')}
    </div>
  </div>`;
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

/* ============================================================ account */

function accountVideoHtml(v, accountId) {
  const actions = `<div class="account-actions">
    <button type="button" class="btn-outline btn-xs" data-acct-next ${queueAttrs(v)}>Play next</button>
    <button type="button" class="btn-outline btn-xs" data-acct-add ${queueAttrs(v)}>Add to queue</button>
  </div>`;
  const suffix = accountId ? `?acct=${encodeURIComponent(accountId)}` : '';
  return ytCardHtml(v, actions, suffix);
}

export function renderAccount({ id, name } = {}) {
  const label = name || id || 'Account';
  const active = store.accountFilter()?.id === id;
  return `<div class="page account-page">
    <div class="account-head">
      ${avatar({ name: label, color: colorFor(label) })}
      <div class="account-info">
        <span class="account-eyebrow">YouTube account</span>
        <h1>${esc(label)}</h1>
        <p>Only videos from this account. Queue them up and autoplay stays inside it.</p>
      </div>
    </div>
    <div class="account-toolbar">
      <button type="button" class="btn-primary" data-acct-playall>${icon('play')} Play all</button>
      <button type="button" class="btn-outline" data-acct-addall>${icon('plus')} Add all to queue</button>
      <button type="button" class="btn-outline ${active ? 'active' : ''}" data-acct-toggle aria-pressed="${active}">${active ? 'Account only: on' : 'Account only'}</button>
      <button type="button" class="text-btn" data-acct-clearqueue>Clear queue</button>
    </div>
    <p class="account-status" data-acct-status role="status"></p>
    <div class="grid" data-acct-grid></div>
    <div class="feed-loader" data-acct-loading hidden><span class="spinner"></span></div>
    <div class="feed-end" data-acct-more hidden><button type="button" class="btn-more" data-acct-loadmore>Load more videos</button></div>
  </div>`;
}

/** Account-only view: live search restricted to one channel, with a queue that
    autoplays only that channel's videos (NewPipe SinglePlayQueue pattern). */
export async function mountAccount(root, { id, name } = {}) {
  const grid = root.querySelector('[data-acct-grid]');
  if (!grid) return {};
  const label = name || id || '';
  if (!label) return {};

  const videos = [];
  const seen = new Set();
  let tokens = [];
  const status = root.querySelector('[data-acct-status]');
  const loader = root.querySelector('[data-acct-loading]');
  const more = root.querySelector('[data-acct-more]');
  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  const matches = (v) => {
    if (!v) return false;
    const chId = String(v.channelId || '');
    const ch = String(v.channel || '').toLowerCase();
    return (!!id && chId === id) || ch === label.toLowerCase();
  };

  const paint = () => {
    grid.innerHTML = videos.length
      ? videos.map((v) => accountVideoHtml(v, id)).join('')
      : '<p class="related-empty">No videos found for this account yet.</p>';
  };

  const load = async (nextPage = false) => {
    if (loader) loader.hidden = !nextPage;
    if (more) more.hidden = true;
    try {
      const data = nextPage && tokens[0]
        ? await searchYouTube('', { continuation: tokens[0] })
        : await searchYouTube(label);
      if (!data) return;
      tokens = data.continuation ? [data.continuation] : [];
      const fresh = (data.videos || []).filter((v) => matches(v) && !seen.has(v.id));
      for (const v of fresh) {
        seen.add(v.id);
        videos.push(v);
      }
      paint();
    } catch {
      setStatus('Couldn’t load videos for this account. Try again.');
    } finally {
      if (loader) loader.hidden = true;
      if (more) more.hidden = !tokens.length;
    }
  };

  const toggleBtn = root.querySelector('[data-acct-toggle]');
  const paintToggle = () => {
    const active = store.accountFilter()?.id === id;
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('active', !!active);
    toggleBtn.setAttribute('aria-pressed', String(!!active));
    toggleBtn.textContent = active ? 'Account only: on' : 'Account only';
  };
  toggleBtn?.addEventListener('click', () => {
    if (store.accountFilter()?.id === id) {
      store.clearAccountFilter();
      setStatus('Account-only autoplay is off.');
    } else {
      store.setAccountFilter(id, label);
      setStatus(`Autoplay will now stay inside ${label}.`);
    }
    paintToggle();
  });

  root.querySelector('[data-acct-addall]')?.addEventListener('click', () => {
    const added = store.addManyToQueue(videos, `account:${id}`);
    setStatus(added ? `Added ${added} videos to Up Next.` : 'Those videos are already queued.');
  });

  root.querySelector('[data-acct-playall]')?.addEventListener('click', () => {
    if (!videos.length) return;
    store.setAccountFilter(id, label);
    store.clearQueue();
    store.addManyToQueue(videos.slice(1), `account:${id}`);
    paintToggle();
    navigate(`/watch/yt/${encodeURIComponent(videos[0].id)}?autoplay=1`);
  });

  root.querySelector('[data-acct-clearqueue]')?.addEventListener('click', () => {
    store.clearQueue();
    setStatus('Up Next cleared.');
  });

  grid.addEventListener('click', (event) => {
    const add = event.target.closest('[data-acct-add]');
    const next = event.target.closest('[data-acct-next]');
    if (!add && !next) return;
    event.preventDefault();
    const el = add || next;
    const video = {
      id: el.dataset.addQueue,
      title: el.dataset.qTitle,
      channel: el.dataset.qChannel,
      thumb: el.dataset.qThumb,
      length: el.dataset.qLength,
    };
    if (next) store.playNextVideo(video, `account:${id}`);
    else store.addToQueue(video, `account:${id}`);
    setStatus(next ? 'Will play next.' : 'Added to Up Next.');
  });

  more?.addEventListener('click', () => load(true));

  // Opening an account turns on account-only autoplay immediately.
  store.setAccountFilter(id, label);
  paintToggle();
  await load(false);
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

export function settingsFiltersHtml() {
  const keywords = store.hiddenKeywords();
  const channels = store.hiddenChannels();
  const renderList = (items, removeAttr, label) => {
    if (!items.length) return `<span class="settings-empty">No ${label} yet.</span>`;
    return items
      .map(
        (v) =>
          `<span class="topic-pill">${esc(v)}<button type="button" ${removeAttr}="${esc(v)}" aria-label="Remove ${esc(v)}">${icon('x')}</button></span>`
      )
    .join('');
  };
  return `<div class="settings-filters">
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="flex:1;">
        <div class="settings-card-head" style="margin-bottom:8px;"><h3 style="margin:0 0 4px;">Keywords</h3></div>
        <div class="settings-topics">${renderList(keywords, 'data-remove-keyword', 'keywords')}</div>
      </div>
      <div style="flex:1;">
        <div class="settings-card-head" style="margin-bottom:8px;"><h3 style="margin:0 4px;">Channels</h3></div>
        <div class="settings-topics">${renderList(channels, 'data-remove-channel', 'channels')}</div>
      </div>
    </div>
    <div class="settings-actions" style="display:flex;gap:10px;">
      <button type="button" class="btn-outline" data-manage-keyword>${icon('plus')} Add keyword</button>
      <button type="button" class="btn-outline" data-manage-channel>${icon('plus')} Add channel</button>
    </div>
    <p class="settings-status" data-filter-status role="status"></p>
  </div>`;
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
          <h2>Your data</h2>
          <p>Watch history and cached files stay on this device. Likes, Watch later and playlists are kept when you clear history.</p>
        </div>
        <span class="settings-badge" data-history-count>${store.ytHistoryList().length} watched</span>
      </div>
      <div class="settings-actions">
        <button type="button" class="btn-outline" data-clear-watch-history>${icon('trash')} Clear watch history</button>
        <button type="button" class="btn-outline" data-clear-cache>${icon('refresh')} Clear cache</button>
      </div>
      <p class="settings-status" data-clear-status role="status"></p>
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
          <h2>Background playback</h2>
          <p>Let dinosour keep playing when the screen is off or the app is in the background.</p>
        </div>
        <span class="settings-badge" data-battery-badge>${app ? 'Checking…' : 'App only'}</span>
      </div>
      <div class="settings-actions">
        <button type="button" class="btn-outline" data-battery-opt ${app ? '' : 'disabled'}>${icon('moon')} Allow background playback</button>
      </div>
      <p class="settings-status" data-battery-status role="status"></p>
    </section>

    ${app ? `
    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2>Diagnostics</h2>
          <p>If dinosour ever closes unexpectedly, a crash report is saved here automatically. Copy it and send it along with any bug report.</p>
        </div>
        <span class="settings-badge" data-crash-badge>—</span>
      </div>
      <div class="settings-actions">
        <button type="button" class="btn-outline" data-copy-crash>${icon('download')} Copy crash log</button>
        <button type="button" class="btn-outline" data-clear-crash>${icon('trash')} Clear crash log</button>
      </div>
      <p class="settings-status" data-crash-status role="status"></p>
    </section>` : ''}

    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2>Content filters</h2>
          <p>Hide videos by keyword or channel. Hidden videos won’t appear in search, trending or your feed.</p>
        </div>
        <span class="settings-badge" data-filter-count>0 hidden</span>
      </div>
      <div class="settings-filters">${settingsFiltersHtml()}</div>
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
