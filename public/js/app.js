/* App bootstrap: router, header, search, sidebar, hover previews. */

import { channelById, loadCatalog, relatedFor, searchChannels, searchVideos, videoById } from './data.js';
import { store } from './store.js';
import { $, $$, APP_MODE, compact, debounce, esc, icon, prefersReducedMotion } from './util.js';
import { closeMenu, navigate, openMenu, toast } from './ui.js';
import { attachStream, detachStream } from './stream.js';
import { suggestYouTube } from './yt.js';
import { closeMini, openMini } from './mini.js';
import { onMediaCommand, setAppVisible, stopMedia } from './media.js';
import {
  mountChannel,
  mountHome,
  mountLibrary,
  mountRemoteWatch,
  mountResults,
  mountTrending,
  mountWatch,
  renderChannel,
  renderChips,
  renderHome,
  renderLibrary,
  renderNotFound,
  renderRemoteWatch,
  renderResults,
  renderSettings,
  renderTrending,
  renderWatch,
  settingsTopicsHtml,
} from './views.js';

const SITE_NAME = 'dinosour';

/* Notification and lock-screen buttons call into the app through this hook. */
window.__dinosourMediaCommand = onMediaCommand;

/* MainActivity reports foreground/background so hidden embeds can be kept
   playing without fighting the user's own pause in the foreground. */
window.__dinosourAppVisible = setAppVisible;

/* Web build fallback: a hidden tab behaves like a backgrounded app. */
document.addEventListener('visibilitychange', () => {
  setAppVisible(document.visibilityState !== 'hidden');
});

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
  { key: 'playlists', href: '/feed/playlists', label: 'Playlists', icon: 'music' },
];

function buildSidebar() {
  const html = NAV.map((item) => {
    if (item.divider) return '<div class="nav-divider"></div>';
    return `<a class="nav-item" href="${item.href}" data-link data-nav="${item.key}">${icon(item.icon)}<span>${item.label}</span></a>`;
  }).join('');
  $('#sidebarInner').innerHTML = html;
}

/* The standalone app uses the same library destinations now that they read
   YouTube data. On the mobile bar, History and Watch later both live behind
   Library, so swap History for Settings to keep five tabs. */
function pruneAppNav() {
  if (!APP_MODE) return;

  const mobile = document.querySelector('.mobile-nav');
  mobile?.querySelector('[data-nav="history"]')?.remove();
  const library = mobile?.querySelector('[data-nav="watch-later"]');
  if (library) {
    library.href = '/feed/watch-later';
    const label = library.querySelector('span');
    if (label) label.textContent = 'Library';
  }
  if (mobile && !mobile.querySelector('[data-nav="settings"]')) {
    mobile.insertAdjacentHTML(
      'beforeend',
      `<a href="/settings" data-link class="mobile-nav-item" data-nav="settings">${icon('sliders')}<span>Settings</span></a>`
    );
  }

  const sidebar = $('#sidebarInner');
  if (sidebar && !sidebar.querySelector('[data-nav="settings"]')) {
    sidebar.insertAdjacentHTML(
      'beforeend',
      `<div class="nav-divider"></div><a class="nav-item" href="/settings" data-link data-nav="settings">${icon(
        'sliders'
      )}<span>Settings</span></a>`
    );
  }

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

  const clearResume = e.target.closest('[data-clear-resume]');
  if (clearResume) {
    store.clearResume();
    view.querySelector('.resume-rail')?.remove();
    toast('Continue watching cleared');
    return;
  }

  const addTopic = e.target.closest('[data-topic-add]');
  if (addTopic) {
    e.preventDefault();
    openTopics();
    return;
  }

  const chip = e.target.closest('[data-chip]');
  if (chip) {
    const cat = chip.dataset.chip;
    const onTrending = location.pathname === '/feed/trending';
    const base = onTrending ? '/feed/trending' : '/';
    navigate(cat === 'All' ? base : `${base}?c=${encodeURIComponent(cat)}`);
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

/* --------------------------------------------------------- topics sheet */

const TOPIC_IDEAS = ['Gaming', 'Football', 'Cooking', 'News', 'Comedy', 'Science', 'Movies', 'Workout'];

let sheetEl = null;
let sheetChanged = false;
let topicsChangedHook = null;

function topicPillsHtml() {
  const topics = store.customTopics();
  if (!topics.length) return '<p class="topic-empty">No topics yet — add your first one above.</p>';
  return topics
    .map(
      (t) =>
        `<span class="topic-pill">${esc(t)}<button type="button" data-topic-remove="${esc(t)}" aria-label="Remove ${esc(t)}">${icon(
          'x'
        )}</button></span>`
    )
    .join('');
}

function ideasHtml() {
  const topics = store.customTopics();
  const ideas = TOPIC_IDEAS.filter((i) => !topics.some((t) => t.toLowerCase() === i.toLowerCase()));
  return ideas.map((i) => `<button type="button" class="idea-chip" data-topic-idea="${esc(i)}">${esc(i)}</button>`).join('');
}

function topicsSheetHtml() {
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="topicsTitle">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <div>
        <h2 id="topicsTitle">Your topics</h2>
        <p>Add anything you like. Each one becomes a button above your feed.</p>
      </div>
      <button type="button" class="icon-btn sheet-close" data-sheet-close aria-label="Close">${icon('x')}</button>
    </div>
    <form class="topic-form" data-topic-form>
      <input class="topic-input" data-topic-input maxlength="40" placeholder="football, cooking, lofi…" autocomplete="off" enterkeyhint="done" aria-label="New topic">
      <button class="btn-primary topic-submit" type="submit" disabled>Add</button>
    </form>
    <div class="topic-ideas" data-topic-ideas-wrap>
      <span class="sheet-label">Need an idea?</span>
      <div class="idea-row" data-topic-ideas>${ideasHtml()}</div>
    </div>
    <div class="topic-list-wrap">
      <span class="sheet-label" data-topic-count>Your topics · 0/12</span>
      <div class="topic-list" data-topic-list>${topicPillsHtml()}</div>
    </div>
    <p class="topic-hint">Tap a topic on the home screen to switch your feed.</p>
  </div>`;
}

function openTopics() {
  closeTopics(true);
  sheetChanged = false;
  sheetEl = document.createElement('div');
  sheetEl.className = 'sheet-scrim';
  sheetEl.innerHTML = topicsSheetHtml();
  document.body.appendChild(sheetEl);
  document.body.classList.add('sheet-open');

  const input = sheetEl.querySelector('[data-topic-input]');
  const submit = sheetEl.querySelector('.topic-submit');

  const paint = () => {
    const topics = store.customTopics();
    const list = sheetEl?.querySelector('[data-topic-list]');
    const count = sheetEl?.querySelector('[data-topic-count]');
    const ideas = sheetEl?.querySelector('[data-topic-ideas]');
    const ideasWrap = sheetEl?.querySelector('[data-topic-ideas-wrap]');
    if (list) list.innerHTML = topicPillsHtml();
    if (count) count.textContent = `Your topics · ${topics.length}/12`;
    if (ideas) ideas.innerHTML = ideasHtml();
    if (ideasWrap) ideasWrap.hidden = topics.length >= TOPIC_IDEAS.length + 4;
    if (submit) submit.disabled = !input?.value.trim() || topics.length >= 12;
  };
  sheetEl.__paint = paint;

  input.addEventListener('input', paint);

  sheetEl.querySelector('[data-topic-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    if (store.customTopics().length >= 12) {
      toast('You can add up to 12 topics');
      return;
    }
    if (store.customTopics().some((t) => t.toLowerCase() === name.toLowerCase())) {
      toast('That topic is already there');
      input.select();
      return;
    }
    const added = store.addTopic(name);
    if (!added) {
      toast('Could not add that topic');
      return;
    }
    input.value = '';
    sheetChanged = true;
    paint();
    toast(`Added “${added}”`);
  });

  sheetEl.addEventListener('click', (event) => {
    if (event.target === sheetEl || event.target.closest('[data-sheet-close]')) {
      closeTopics();
      return;
    }
    const idea = event.target.closest('[data-topic-idea]');
    if (idea) {
      const added = store.addTopic(idea.dataset.topicIdea);
      if (!added) {
        toast('You can add up to 12 topics');
        return;
      }
      sheetChanged = true;
      sheetEl?.__paint?.();
      toast(`Added “${added}”`);
      return;
    }
    const remove = event.target.closest('[data-topic-remove]');
    if (remove) {
      store.removeTopic(remove.dataset.topicRemove);
      sheetChanged = true;
      sheetEl?.__paint?.();
    }
  });

  document.addEventListener('keydown', onSheetKey);
  paint();
  setTimeout(() => input.focus(), 80);
}

function onSheetKey(event) {
  if (event.key === 'Escape') closeTopics();
}

function closeTopics(silent = false) {
  if (!sheetEl) return;
  document.removeEventListener('keydown', onSheetKey);
  sheetEl.remove();
  sheetEl = null;
  document.body.classList.remove('sheet-open');

  if (!silent && sheetChanged) {
    const wrap = view.querySelector('.chips-wrap');
    if (wrap) {
      const active = wrap.querySelector('.chip.active')?.dataset.chip || 'All';
      const still = active === 'All' || store.customTopics().some((t) => t.toLowerCase() === active.toLowerCase());
      if (!still) {
        navigate(location.pathname === '/feed/trending' ? '/feed/trending' : '/');
        topicsChangedHook?.();
        return;
      }
      wrap.outerHTML = renderChips(active);
    }
    topicsChangedHook?.();
  }
  sheetChanged = false;
}

/* Keeps the chips bar in sync after settings edits. */
function refreshChipsInPlace() {
  const wrap = view.querySelector('.chips-wrap');
  if (!wrap) return;
  const active = wrap.querySelector('.chip.active')?.dataset.chip || 'All';
  const still = active === 'All' || store.customTopics().some((t) => t.toLowerCase() === active.toLowerCase());
  wrap.outerHTML = renderChips(still ? active : 'All');
}

/* ------------------------------------------------------------- settings */

function setUpdateStatus(text, tone = '') {
  const el = view.querySelector('[data-update-status]');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function mountSettings(root) {
  const bridge = window.Dinosour;
  const versionEl = root.querySelector('[data-app-version]');
  const install = root.querySelector('[data-install-update]');
  const check = root.querySelector('[data-check-update]');

  if (versionEl) versionEl.textContent = bridge?.appVersion?.() || (APP_MODE ? '—' : 'Web');

  const paintTopics = () => {
    const list = root.querySelector('[data-settings-topics]');
    const count = root.querySelector('[data-topic-count]');
    if (list) list.innerHTML = settingsTopicsHtml();
    if (count) count.textContent = `${store.customTopics().length} / 12`;
  };
  paintTopics();
  topicsChangedHook = paintTopics;

  const showReady = (version) => {
    if (!install || !version) return;
    install.hidden = false;
    install.dataset.version = version;
    setUpdateStatus(`dinosour ${version} is downloaded and ready to install.`, 'ok');
  };

  const ready = bridge?.readyVersion?.();
  if (ready) showReady(ready);
  else if (APP_MODE) setUpdateStatus('Updates are checked automatically. You can also check now.', '');

  window.__dinosourNative = {
    update(state, message) {
      if (!root.isConnected) return;
      if (state === 'checking') setUpdateStatus(message || 'Checking for updates…');
      else if (state === 'downloading') setUpdateStatus(message || 'Downloading update…');
      else if (state === 'uptodate') {
        setUpdateStatus(message || 'You are on the latest version.', 'ok');
        if (install) install.hidden = true;
      } else if (state === 'ready') {
        if (install) install.hidden = false;
        setUpdateStatus(message || 'Update ready to install.', 'ok');
      } else if (state === 'installing') setUpdateStatus('Opening the installer…');
      else if (state === 'error') setUpdateStatus(message || 'Could not check for updates.', 'err');
    },
  };

  check?.addEventListener('click', () => {
    if (!bridge?.checkNow) {
      setUpdateStatus('Update checks are only available in the Android app.');
      return;
    }
    setUpdateStatus('Checking for updates…');
    bridge.checkNow();
  });

  install?.addEventListener('click', () => {
    if (!bridge?.installNow) return;
    setUpdateStatus('Opening the installer…');
    bridge.installNow();
  });

  root.querySelector('[data-manage-topics]')?.addEventListener('click', openTopics);

  root.querySelector('[data-settings-topics]')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-topic-remove]');
    if (!remove) return;
    store.removeTopic(remove.dataset.topicRemove);
    paintTopics();
    refreshChipsInPlace();
    toast('Topic removed');
  });

  root.querySelectorAll('[data-theme-pick]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themePick === store.state.theme);
    button.addEventListener('click', () => {
      const theme = button.dataset.themePick;
      store.set('theme', theme);
      applyTheme(theme);
      root.querySelectorAll('[data-theme-pick]').forEach((b) => b.classList.toggle('active', b === button));
    });
  });

  root.querySelector('[data-clear-watch-history]')?.addEventListener('click', () => {
    store.clearYtHistory();
    store.clearHistory();
    store.clearResume();
    const count = root.querySelector('[data-history-count]');
    if (count) count.textContent = '0 watched';
    const status = root.querySelector('[data-clear-status]');
    if (status) {
      status.textContent = 'Watch history cleared. Likes, Watch later and playlists are still here.';
      status.dataset.tone = 'ok';
    }
    toast('Watch history cleared');
  });

  root.querySelector('[data-clear-cache]')?.addEventListener('click', async () => {
    let cleared = false;
    try {
      if (window.Dinosour?.clearCache) {
        window.Dinosour.clearCache();
        cleared = true;
      }
    } catch {
      /* bridge unavailable */
    }
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        if (keys.length) cleared = true;
      }
    } catch {
      /* Cache Storage may be blocked */
    }
    const status = root.querySelector('[data-clear-status]');
    if (status) {
      status.textContent = cleared
        ? 'Cache cleared. Your library, settings and history were kept.'
        : 'There is no cached data to clear.';
      status.dataset.tone = 'ok';
    }
    toast('Cache cleared');
  });

  refreshChipsInPlace();
}



const TITLES = {
  history: 'Watch history',
  'watch-later': 'Watch later',
  liked: 'Liked videos',
  playlists: 'Playlists',
};

function renderRoute() {
  view.__feedCleanup?.();
  view.__feedCleanup = null;
  closeTopics(true);
  topicsChangedHook = null;
  window.__dinosourNative = null;
  closeMenu();
  stopPreview?.();

  // A watch page takes over from the mini player; any other route keeps it.
  const takingOver = location.pathname.split('/').filter(Boolean)[0] === 'watch';
  const watch = currentWatch;
  const handoff = watch?.handOff?.() || null;
  if (takingOver) closeMini();

  watch?.destroy();
  currentWatch = null;
  // A paused video that is not handing over to a mini or another watch page
  // has nothing left to control, so end the session.
  if (watch && !handoff && !takingOver) stopMedia();
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
    const topics = store.customTopics();
    const requested = url.searchParams.get('c') || 'All';
    const match =
      requested === 'All'
        ? 'All'
        : topics.find((t) => t.toLowerCase() === requested.toLowerCase());
    const topic = match || 'All';
    html = renderHome({ topic });
    mount = () => {
      mountHome(view, topic);
    };
    title = topic === 'All' ? '' : topic;
    searchInput.value = '';
    searchClear.hidden = true;
  } else if (seg[0] === 'settings') {
    html = renderSettings();
    mount = () => {
      mountSettings(view);
    };
    title = 'Settings';
    searchInput.value = '';
    searchClear.hidden = true;
  } else if (seg[0] === 'watch' && seg[1] === 'yt' && /^[\w-]{11}$/.test(seg[2] || '')) {
    const id = seg[2];
    html = renderRemoteWatch(id);
    mount = () => {
      currentWatch = mountRemoteWatch(view, id);
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
  } else if (seg[0] === 'feed' && seg[1] === 'playlists') {
    html = renderLibrary('playlists');
    mount = () => {
      mountLibrary(view, 'playlists');
    };
    title = 'Playlists';
  } else if (seg[0] === 'feed' && seg[1] === 'playlist' && seg[2]) {
    html = renderLibrary('playlist', seg[2]);
    mount = () => {
      mountLibrary(view, 'playlist', seg[2]);
    };
    title = store.playlistById(seg[2])?.name || 'Playlist';
  } else if (seg[0] === 'feed' && seg[1] && TITLES[seg[1]]) {
    html = renderLibrary(seg[1]);
    mount = () => {
      mountLibrary(view, seg[1]);
    };
    title = TITLES[seg[1]];
  } else if (seg[0] === 'feed' && seg[1] === 'trending') {
    const topics = store.customTopics();
    const requested = url.searchParams.get('c') || 'All';
    const match =
      requested === 'All'
        ? 'All'
        : topics.find((t) => t.toLowerCase() === requested.toLowerCase());
    const topic = match || 'All';
    html = renderTrending({ topic });
    mount = () => {
      mountTrending(view, topic);
    };
    title = topic === 'All' ? 'Trending' : `${topic} — Trending`;
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

  // Keep the video going in the corner when you leave the watch page.
  if (handoff && !takingOver) openMini(handoff);
}

function updateActiveNav(seg) {
  let key = '';
  if (seg.length === 0) key = 'home';
  else if (seg[0] === 'settings') key = 'settings';
  else if (seg[0] === 'results') key = 'search';
  else if (seg[0] === 'feed') {
    key = seg[1] === 'trending' ? 'trending' : seg[1] === 'playlist' ? 'playlists' : seg[1];
  }
  $$('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === key));
  // The phone bar has one Library tab covering all /feed library pages.
  const libraryPage = ['history', 'watch-later', 'liked', 'playlists'].includes(key);
  if (libraryPage) {
    document.querySelector('.mobile-nav [data-nav="watch-later"]')?.classList.add('active');
  }
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
  view.innerHTML = `${renderChips('All')}
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
