/* App bootstrap: router, header, search, sidebar, hover previews. */

import { categories, channelById, loadCatalog, relatedFor, searchChannels, searchVideos, videoById } from './data.js';
import { store } from './store.js';
import { $, $$, APP_MODE, compact, debounce, esc, icon, prefersReducedMotion } from './util.js';
import { closeMenu, navigate, openMenu, toast } from './ui.js';
import { attachStream, detachStream } from './stream.js';
import { suggestYouTube } from './yt.js';
import {
  mountChannel,
  mountHome,
  mountLibrary,
  mountRemoteWatch,
  mountResults,
  mountTrending,
  mountWatch,
  renderChannel,
  renderHome,
  renderLibrary,
  renderNotFound,
  renderRemoteWatch,
  renderResults,
  renderTrending,
  renderWatch,
} from './views.js';

const SITE_NAME = 'dinosour';

const view = $('#view');
const searchForm = $('#searchForm');
const searchInput = $('#searchInput');
const searchClear = $('#searchClear');
const suggestions = $('#suggestions');
const scrim = $('#scrim');
const menuBtn = $('#menuBtn');
const themeBtn = $('#themeBtn');

let currentWatch = null;
let stopPreview = null;

/* ------------------------------------------------------------ theme */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0f0f0f' : '#ffffff';
  themeBtn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  themeBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}

themeBtn.addEventListener('click', () => {
  const next = store.state.theme === 'dark' ? 'light' : 'dark';
  store.set('theme', next);
  applyTheme(next);
});

/* ------------------------------------------------------------ sidebar */

const NAV = [
  { key: 'home', href: '/', label: 'Home', icon: 'home' },
  { key: 'trending', href: '/feed/trending', label: 'Trending', icon: 'flame' },
  { divider: true },
  { key: 'history', href: '/feed/history', label: 'History', icon: 'history' },
  { key: 'watch-later', href: '/feed/watch-later', label: 'Watch later', icon: 'clock' },
  { key: 'liked', href: '/feed/liked', label: 'Liked videos', icon: 'thumb-up' },
];

function buildSidebar() {
  const html = NAV.map((item) => {
    if (item.divider) return '<div class="nav-divider"></div>';
    return `<a class="nav-item" href="${item.href}" data-link data-nav="${item.key}">${icon(item.icon)}<span>${item.label}</span></a>`;
  }).join('');
  $('#sidebarInner').innerHTML = html;
}

/* The standalone app has no local library, so drop those destinations. */
function pruneAppNav() {
  if (!APP_MODE) return;
  $$('[data-nav="history"], [data-nav="watch-later"], [data-nav="liked"]').forEach((el) => el.remove());
  $$('#sidebarInner .nav-divider').forEach((el) => {
    if (!el.nextElementSibling) el.remove();
  });
  const credit = document.querySelector('.sidebar-credit');
  if (credit) credit.textContent = 'Powered by YouTube';
}

function setMini(mini) {
  const useMini = mini && window.innerWidth > 1024;
  document.body.classList.toggle('mini', useMini);
  menuBtn.setAttribute('aria-label', useMini ? 'Expand sidebar' : 'Collapse sidebar');
}

menuBtn.addEventListener('click', () => {
  if (window.innerWidth <= 1024) {
    const open = document.body.classList.toggle('drawer');
    scrim.hidden = !open;
  } else {
    const mini = !document.body.classList.contains('mini');
    store.set('mini', mini);
    setMini(mini);
  }
});

function closeDrawer() {
  document.body.classList.remove('drawer');
  scrim.hidden = true;
}
scrim.addEventListener('click', closeDrawer);

/* ------------------------------------------------------------ search */

let activeIndex = -1;
let suggestionRows = [];
let suggestionToken = 0;

function hideSuggestions() {
  suggestionToken += 1;
  suggestions.hidden = true;
  activeIndex = -1;
  suggestionRows = [];
}

function paintSuggestions(rows) {
  suggestionRows = rows;
  if (!rows.length) return hideSuggestions();

  suggestions.innerHTML = rows
    .map(
      (r, i) =>
        `<button type="button" class="suggestion" data-index="${i}" role="option">
          ${icon(r.icon)}<span class="sug-label">${esc(r.label)}</span><span class="sug-chan">${esc(r.meta)}</span>
        </button>`
    )
    .join('');
  suggestions.hidden = false;
  activeIndex = -1;
}

function localSuggestionRows(q) {
  const vids = searchVideos(q, 4);
  const chans = searchChannels(q, 2);
  return [
    ...vids.map((v) => ({ type: 'video', id: v.id, label: v.title, meta: v.channelData.name, icon: 'play' })),
    ...chans.map((c) => ({ type: 'channel', id: c.id, label: c.name, meta: `${compact(c.videoCount)} videos`, icon: 'film' })),
  ];
}

function showSuggestions() {
  const q = searchInput.value.trim();
  searchClear.hidden = !q;
  if (!q) return hideSuggestions();

  suggestionToken += 1;
  const localRows = APP_MODE ? [] : localSuggestionRows(q);
  paintSuggestions(localRows);
  // paintSuggestions() hides and bumps the token when there are no rows yet.
  const token = suggestionToken;

  suggestYouTube(q)
    .then((list) => {
      if (token !== suggestionToken) return;
      const seen = new Set(localRows.map((r) => r.label.toLowerCase()));
      const ytRows = list
        .filter((s) => !seen.has(s.toLowerCase()))
        .slice(0, 6)
        .map((s) => ({ type: 'query', label: s, meta: 'Search YouTube', icon: 'search' }));
      paintSuggestions([...localRows, ...ytRows]);
    })
    .catch(() => {
      /* suggestions are optional */
    });
}

function activateSuggestion(index) {
  const row = suggestionRows[index];
  if (!row) return;
  hideSuggestions();
  searchInput.blur();
  if (row.type === 'video') navigate(`/watch/${row.id}`);
  else if (row.type === 'channel') navigate(`/channel/${row.id}`);
  else {
    searchInput.value = row.label;
    navigate(`/results?search_query=${encodeURIComponent(row.label)}`);
  }
}

function moveSuggestion(delta) {
  if (suggestions.hidden || !suggestionRows.length) return;
  activeIndex = (activeIndex + delta + suggestionRows.length) % suggestionRows.length;
  $$('.suggestion', suggestions).forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  $('.suggestion.active', suggestions)?.scrollIntoView({ block: 'nearest' });
}

searchInput.addEventListener('input', debounce(showSuggestions, 70));
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) showSuggestions();
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSuggestion(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSuggestion(-1);
  } else if (e.key === 'Enter') {
    if (activeIndex >= 0) {
      e.preventDefault();
      activateSuggestion(activeIndex);
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
    searchInput.blur();
  }
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) {
    searchInput.focus();
    return;
  }
  hideSuggestions();
  searchInput.blur();
  navigate(`/results?search_query=${encodeURIComponent(q)}`);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.hidden = true;
  hideSuggestions();
  searchInput.focus();
});

suggestions.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.suggestion');
  if (!row) return;
  e.preventDefault();
  activateSuggestion(Number(row.dataset.index));
});

document.addEventListener('pointerdown', (e) => {
  if (!searchForm.contains(e.target)) hideSuggestions();
});

/* ------------------------------------------------------------ links + menus */

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (link) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http')) return;
    e.preventDefault();
    closeDrawer();
    hideSuggestions();
    navigate(href);
    return;
  }

  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const cat = chip.dataset.chip;
    navigate(cat === 'All' ? '/' : `/?c=${encodeURIComponent(cat)}`);
    return;
  }

  const cardMenu = e.target.closest('[data-menu="card"]');
  if (cardMenu) {
    const video = videoById(cardMenu.dataset.id);
    if (!video) return;
    const saved = store.isSaved(video.id);
    openMenu(cardMenu, [
      {
        key: 'save',
        icon: saved ? 'check' : 'save',
        label: saved ? 'Remove from Watch later' : 'Save to Watch later',
        onClick: () => {
          const now = store.toggleSave(video.id);
          toast(now ? 'Saved to Watch later' : 'Removed from Watch later');
        },
      },
      { key: 'copy', icon: 'link', label: 'Copy link', onClick: () => copyText(`${location.origin}/watch/${video.id}`) },
      { sep: true },
      { key: 'channel', icon: 'film', label: `Go to ${video.channelData.name}`, onClick: () => navigate(`/channel/${video.channel}`) },
    ]);
  }
});

function copyText(text) {
  const done = () => toast('Link copied to clipboard');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
  else legacyCopy(text, done);
}

function legacyCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* noop */ }
  ta.remove();
  done();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    hideSuggestions();
  }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isFormField(e.target)) {
    e.preventDefault();
    searchInput.focus();
  }
});

function isFormField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/* ------------------------------------------------------------ hover previews */

function initPreviews() {
  if (prefersReducedMotion() && !location.search.includes('previews')) return;

  let timer = null;
  let currentCard = null;
  let preview = null;
  let previewHls = null;
  let startAt = 0;

  const stop = () => {
    clearTimeout(timer);
    timer = null;
    if (preview) {
      preview.pause();
      detachStream(previewHls);
      previewHls = null;
      preview.removeAttribute('src');
      preview.load();
      preview.remove();
      preview = null;
    }
    currentCard?.querySelector('.thumb')?.classList.remove('previewing');
    currentCard = null;
  };
  stopPreview = stop;

  document.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.card');
    if (!card || card === currentCard) return;
    stop();
    currentCard = card;
    const src = card.dataset.src;
    if (!src) return;

    timer = setTimeout(async () => {
      if (!currentCard || !document.contains(currentCard)) return;
      const thumb = currentCard.querySelector('.thumb');
      if (!thumb) return;
      const cardAtStart = currentCard;
      preview = document.createElement('video');
      preview.muted = true;
      preview.defaultMuted = true;
      preview.playsInline = true;
      preview.preload = 'auto';
      preview.addEventListener('loadedmetadata', () => {
        if (!preview) return;
        startAt = Math.min(6, Math.max(0, preview.duration * 0.15));
        preview.currentTime = startAt;
        preview.play().catch(() => {});
      }, { once: true });
      preview.addEventListener('timeupdate', () => {
        if (!preview) return;
        if (preview.currentTime > startAt + 5) preview.currentTime = startAt;
        if (preview.currentTime < startAt - 0.5) preview.currentTime = startAt;
      });
      thumb.append(preview);
      thumb.classList.add('previewing');

      const hls = await attachStream(preview, src);
      if (!preview || currentCard !== cardAtStart) {
        detachStream(hls);
        return;
      }
      previewHls = hls;
    }, 650);
  });

  document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.card');
    if (!card || card !== currentCard) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    stop();
  });

  window.addEventListener('scroll', stop, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
}

/* ------------------------------------------------------------ router */

const TITLES = {
  history: 'Watch history',
  'watch-later': 'Watch later',
  liked: 'Liked videos',
};

function renderRoute() {
  view.__feedCleanup?.();
  view.__feedCleanup = null;
  closeMenu();
  stopPreview?.();
  currentWatch?.destroy();
  currentWatch = null;
  document.body.classList.remove('theater');
  closeDrawer();
  hideSuggestions();

  const url = new URL(location.href);
  const path = url.pathname;
  const seg = path.split('/').filter(Boolean);
  let html = '';
  let mount = null;
  let title = '';

  if (seg.length === 0) {
    const known = ['All', ...categories()];
    let category = url.searchParams.get('c') || 'All';
    if (!known.some((c) => c.toLowerCase() === category.toLowerCase())) category = 'All';
    const match = known.find((c) => c.toLowerCase() === category.toLowerCase());
    html = renderHome({ category: match || 'All' });
    mount = () => {
      mountHome(view, match || 'All');
    };
    title = '';
    searchInput.value = '';
    searchClear.hidden = true;
  } else if (seg[0] === 'watch' && seg[1] === 'yt' && /^[\w-]{11}$/.test(seg[2] || '')) {
    const id = seg[2];
    html = renderRemoteWatch(id);
    mount = () => {
      mountRemoteWatch(view, id);
    };
    title = 'YouTube';
    searchInput.value = '';
    searchClear.hidden = true;
  } else if (seg[0] === 'watch' && seg[1]) {
    const video = videoById(seg[1]);
    if (video) {
      const next = relatedFor(video, 1)[0] || null;
      html = renderWatch(video, next);
      mount = () => {
        currentWatch = mountWatch(view, video, next);
      };
      title = video.title;
    } else {
      html = renderNotFound();
      title = 'Not found';
    }
  } else if (seg[0] === 'results') {
    const q = url.searchParams.get('search_query') || '';
    html = renderResults(q);
    mount = () => {
      mountResults(view, q);
    };
    title = q ? `${q}` : 'Search';
    if (document.activeElement !== searchInput) {
      searchInput.value = q;
      searchClear.hidden = !q;
    }
  } else if (seg[0] === 'feed' && seg[1] && TITLES[seg[1]]) {
    if (APP_MODE) {
      // The standalone app has no local film library; send these old links home.
      html = renderHome({ category: 'All' });
      mount = () => {
        mountHome(view, 'All');
      };
      title = '';
    } else {
      html = renderLibrary(seg[1]);
      mount = () => {
        mountLibrary(view, seg[1]);
      };
      title = TITLES[seg[1]];
    }
  } else if (seg[0] === 'feed' && seg[1] === 'trending') {
    html = renderTrending();
    if (APP_MODE) mount = () => {
      mountTrending(view);
    };
    title = 'Trending';
  } else if (seg[0] === 'channel' && seg[1]) {
    const ch = channelById(seg[1]);
    html = renderChannel(seg[1]);
    if (ch) mount = () => {
      mountChannel(view, seg[1]);
    };
    title = ch ? ch.name : 'Channel';
  } else {
    html = renderNotFound();
    title = 'Not found';
  }

  view.innerHTML = html;
  try {
    mount?.();
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page"><div class="empty"><div class="empty-icon">${icon('film')}</div><h2>Something went wrong</h2><p>${esc(err.message || 'Unexpected error')}</p><a class="btn-primary" href="/" data-link>Back to home</a></div></div>`;
  }

  document.title = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  window.scrollTo(0, 0);
  updateActiveNav(seg);
}

function updateActiveNav(seg) {
  let key = '';
  if (seg.length === 0) key = 'home';
  else if (seg[0] === 'results') key = 'search';
  else if (seg[0] === 'feed') {
    key = seg[1] === 'trending' ? 'trending' : seg[1] === 'liked' ? 'watch-later' : seg[1];
  }
  $$('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === key));
}

// The bottom bar's Search tab brings the (already visible) search field into focus.
$$('[data-mobile-search]').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    searchInput.focus();
    searchInput.select();
  });
});

window.addEventListener('popstate', renderRoute);
window.addEventListener('resize', debounce(() => {
  if (window.innerWidth > 1024) closeDrawer();
}, 120));

/* ------------------------------------------------------------ boot */

async function boot() {
  applyTheme(store.state.theme);
  setMini(store.state.mini);
  initPreviews();

  // skeleton while the catalog loads (it's local, so this is a blink)
  view.innerHTML = `<div class="chips-wrap"><div class="chips">${['All', 'Animation', 'Space', 'Travel', 'Food', 'Music', 'Tech', 'Nature']
    .map((c, i) => `<span class="chip ${i === 0 ? 'active' : ''}" style="opacity:.5">${c}</span>`)
    .join('')}</div></div>
    <div class="skeleton-grid">${Array.from({ length: 8 }).map(() => `<div><div class="skel skel-thumb"></div><div style="display:flex;gap:12px;margin-top:12px"><div class="skel" style="width:36px;height:36px;border-radius:50%"></div><div style="flex:1"><div class="skel skel-line" style="width:92%"></div><div class="skel skel-line" style="width:50%"></div></div></div></div>`).join('')}</div>`;

  await loadCatalog();
  buildSidebar();
  pruneAppNav();
  updateActiveNav([]);
  renderRoute();
}

boot().catch((err) => {
  console.error(err);
  view.innerHTML = `<div class="page"><div class="empty">
    <div class="empty-icon">${icon('film')}</div>
    <h2>The catalog could not be loaded</h2>
    <p>${esc(err.message || 'Unknown error')}. Make sure the local server is running and the <code>data/catalog.json</code> file exists.</p>
    <a class="btn-primary" href="/" data-link>Try again</a>
  </div></div>`;
});
