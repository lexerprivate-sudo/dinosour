/* Local persistence: likes, saved videos, history, progress, comments, prefs. */

const KEY = 'dinosour.v1';
const LEGACY_KEYS = ['watch.v1', 'tot.v1'];

const defaults = {
  theme: 'dark',
  mini: false,
  liked: {},
  disliked: {},
  saved: {},
  history: [],
  progress: {},
  comments: {},
  commentLikes: {},
  autoplay: true,
  volume: 1,
  muted: false,
  rate: 1,
  topics: [],
  resume: [],
  queue: [],
  ytHistory: [],
  ytLiked: [],
  ytSaved: [],
  playlists: [],
  ytRate: 1,
  ytQuality: 'auto',
  sleepTimer: 0,
  repeatMode: 'off',
  shuffle: false,
  captions: false,
  hiddenKeywords: [],
  hiddenChannels: [],
  trendingTopics: {},
  trendingCustom: [],
  trendingPrefs: {},
  searchHistory: [],
  accountFilter: null,
  nextCursor: 0,
};

/* The built-in Trending sections. Each becomes its own header with its own
   topics, so "Sports" can contain boxing, formula 1, cricket, and so on. */
const TRENDING_CATEGORIES = [
  { name: 'News', seeds: ['world news', 'breaking news', 'news today'] },
  { name: 'Games', seeds: ['gaming highlights', 'game trailer', 'esports'] },
  { name: 'Dance', seeds: ['dance challenge', 'dance performance', 'hip hop dance'] },
  { name: 'Sports', seeds: ['sports highlights', 'football highlights', 'basketball highlights'] },
  { name: 'Music', seeds: ['new music video', 'live concert', 'top songs'] },
  { name: 'Tech', seeds: ['tech review', 'ai news', 'gadget review'] },
  { name: 'Travel', seeds: ['travel vlog', '4k travel film', 'city tour'] },
  { name: 'Food', seeds: ['street food', 'cooking recipe', 'food challenge'] },
];

/* YouTube items are stored with their metadata, because remote videos have no
   local catalog record to look up later. */
function ytEntry(video) {
  if (!video || !video.id) return null;
  const id = String(video.id);
  return {
    id,
    title: String(video.title || 'YouTube video').slice(0, 220),
    channel: String(video.channel || 'YouTube').slice(0, 120),
    thumb: video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`,
    length: String(video.length || ''),
    at: Number(video.at) || Date.now(),
  };
}

function ytUpsert(list, video, { stamp = true } = {}) {
  const entry = ytEntry(video);
  if (!entry) return list;
  const index = list.findIndex((item) => item && item.id === entry.id);
  if (index === -1) return [entry, ...list];
  const prev = list[index];
  // Keep a real title when a later write only has the loading placeholder.
  if (entry.title === 'YouTube video' && prev.title) entry.title = prev.title;
  if (!entry.channel && prev.channel) entry.channel = prev.channel;
  if (!entry.length && prev.length) entry.length = prev.length;
  entry.at = stamp ? Date.now() : prev.at;
  return [entry, ...list.slice(0, index), ...list.slice(index + 1)];
}

function read() {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // Carry watch history and likes over from older names on first run.
      for (const legacy of LEGACY_KEYS) {
        const value = localStorage.getItem(legacy);
        if (value) {
          raw = value;
          localStorage.setItem(KEY, value);
          localStorage.removeItem(legacy);
          break;
        }
      }
    }
    const parsed = JSON.parse(raw || '{}');
    return { ...structuredClone(defaults), ...parsed };
  } catch {
    return structuredClone(defaults);
  }
}

export const store = {
  state: read(),

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* storage may be unavailable in private mode — app still works in memory */
    }
    return this.state;
  },

  set(key, value) {
    this.state[key] = value;
    this.save();
  },

  isLiked(id) { return !!this.state.liked[id]; },
  isDisliked(id) { return !!this.state.disliked[id]; },
  isSaved(id) { return !!this.state.saved[id]; },

  toggleLike(id) {
    if (this.state.liked[id]) delete this.state.liked[id];
    else {
      this.state.liked[id] = true;
      delete this.state.disliked[id];
    }
    this.save();
    return this.isLiked(id);
  },

  toggleDislike(id) {
    if (this.state.disliked[id]) delete this.state.disliked[id];
    else {
      this.state.disliked[id] = true;
      delete this.state.liked[id];
    }
    this.save();
    return this.isDisliked(id);
  },

  toggleSave(id) {
    if (this.state.saved[id]) delete this.state.saved[id];
    else this.state.saved[id] = true;
    this.save();
    return this.isSaved(id);
  },

  addHistory(id) {
    const h = this.state.history.filter((x) => x.id !== id);
    h.unshift({ id, at: Date.now() });
    this.state.history = h.slice(0, 300);
    this.save();
  },

  removeHistory(id) {
    this.state.history = this.state.history.filter((x) => x.id !== id);
    this.save();
  },

  clearHistory() {
    this.state.history = [];
    this.state.progress = {};
    this.save();
  },

  getProgress(id) {
    const p = this.state.progress[id];
    if (!p || !p.d) return null;
    if (p.t < 4 || p.t > p.d - 6) return null;
    return { ...p, pct: Math.min(100, (p.t / p.d) * 100) };
  },

  setProgress(id, t, d) {
    if (!d || !Number.isFinite(t) || !Number.isFinite(d)) return;
    this.state.progress[id] = { t, d, at: Date.now() };
    this.save();
  },

  clearProgress(id) {
    delete this.state.progress[id];
    this.save();
  },

  addComment(videoId, text) {
    const list = this.state.comments[videoId] || [];
    const comment = {
      id: `local_${Date.now().toString(36)}`,
      author: 'You',
      text,
      at: Date.now(),
      local: true,
      likes: 0,
    };
    list.unshift(comment);
    this.state.comments[videoId] = list;
    this.save();
    return comment;
  },

  deleteComment(videoId, id) {
    this.state.comments[videoId] = (this.state.comments[videoId] || []).filter((c) => c.id !== id);
    this.save();
  },

  localComments(videoId) {
    return this.state.comments[videoId] || [];
  },

  toggleCommentLike(key) {
    if (this.state.commentLikes[key]) delete this.state.commentLikes[key];
    else this.state.commentLikes[key] = true;
    this.save();
    return !!this.state.commentLikes[key];
  },

  isCommentLiked(key) { return !!this.state.commentLikes[key]; },

  likedIds() { return Object.keys(this.state.liked); },
  savedIds() { return Object.keys(this.state.saved); },

  /* Home feed topics. Users invent these themselves; each one becomes a
     YouTube search seed behind its own chip. */
  customTopics() {
    return Array.isArray(this.state.topics) ? this.state.topics.filter((t) => typeof t === 'string' && t) : [];
  },

  addTopic(name) {
    const value = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!value) return null;
    const topics = this.customTopics();
    if (topics.length >= 12) return null;
    if (topics.some((t) => t.toLowerCase() === value.toLowerCase())) return null;
    this.state.topics = [...topics, value];
    this.save();
    return value;
  },

  removeTopic(name) {
    this.state.topics = this.customTopics().filter((t) => t !== name);
    this.save();
  },

  /* Trending: categories and the topics searched inside each one. */
  trendingCategoryNames() {
    const custom = Array.isArray(this.state.trendingCustom)
      ? this.state.trendingCustom.filter((n) => typeof n === 'string' && n)
      : [];
    return [...TRENDING_CATEGORIES.map((c) => c.name), ...custom];
  },

  trendingDefaultTopics(name) {
    const found = TRENDING_CATEGORIES.find(
      (c) => c.name.toLowerCase() === String(name).toLowerCase()
    );
    return found ? [...found.seeds] : [];
  },

  trendingTopicsFor(name) {
    const map = this.state.trendingTopics || {};
    const saved = map[name];
    if (Array.isArray(saved)) return saved.filter((t) => typeof t === 'string' && t);
    return this.trendingDefaultTopics(name);
  },

  addTrendingTopic(category, name) {
    const value = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!value || !category) return null;
    const topics = this.trendingTopicsFor(category);
    if (topics.length >= 10 || topics.some((t) => t.toLowerCase() === value.toLowerCase())) {
      return null;
    }
    this.state.trendingTopics = { ...(this.state.trendingTopics || {}), [category]: [...topics, value] };
    this.save();
    return value;
  },

  removeTrendingTopic(category, name) {
    this.state.trendingTopics = {
      ...(this.state.trendingTopics || {}),
      [category]: this.trendingTopicsFor(category).filter((t) => t !== name),
    };
    this.save();
  },

  /* Trending view preferences and recent searches (both local-only). */
  trendingPref() {
    const p = this.state.trendingPrefs || {};
    return {
      period: ['today', 'week', 'month', 'all'].includes(p.period) ? p.period : 'week',
      sort: p.sort === 'newest' ? 'newest' : 'views',
      category: typeof p.category === 'string' && p.category ? p.category : 'All',
    };
  },

  setTrendingPref(part) {
    this.state.trendingPrefs = { ...this.trendingPref(), ...part };
    this.save();
  },

  recentSearches() {
    return Array.isArray(this.state.searchHistory)
      ? this.state.searchHistory.filter((s) => typeof s === 'string' && s).slice(0, 10)
      : [];
  },

  addSearch(query) {
    const q = String(query || '').trim().slice(0, 120);
    if (!q) return;
    this.state.searchHistory = [q, ...this.recentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, 12);
    this.save();
  },

  clearSearchHistory() {
    this.state.searchHistory = [];
    this.save();
  },

  addTrendingCategory(name) {
    const value = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!value) return null;
    const names = this.trendingCategoryNames();
    if (names.some((n) => n.toLowerCase() === value.toLowerCase())) return null;
    this.state.trendingCustom = [...names.filter((n) => !TRENDING_CATEGORIES.some((c) => c.name === n)), value];
    this.state.trendingTopics = { ...(this.state.trendingTopics || {}), [value]: [] };
    this.save();
    return value;
  },

  /* Continue watching for YouTube playback. Entries hold the metadata the
     home rail needs, so a position survives even though the app has no
     local catalog for remote videos. */
  resumeList() {
    if (!Array.isArray(this.state.resume)) return [];
    return this.state.resume.filter(
      (r) => r && r.id && Number.isFinite(r.t) && Number.isFinite(r.d) && r.d > 0
    );
  },

  resumeFor(id) {
    return this.resumeList().find((r) => r.id === id) || null;
  },

  saveResume(entry) {
    if (!entry || !entry.id) return;
    const t = Number(entry.t);
    const d = Number(entry.d);
    if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;

    const rest = this.resumeList().filter((r) => r.id !== entry.id);
    // Finished, or barely started: drop it instead of keeping a stale row.
    if (t < 4 || t > d - 6) {
      this.state.resume = rest;
      this.save();
      return;
    }

    rest.unshift({
      id: entry.id,
      title: entry.title || 'YouTube video',
      channel: entry.channel || '',
      thumb: entry.thumb || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
      t,
      d,
      at: Date.now(),
    });
    this.state.resume = rest.slice(0, 30);
    this.save();
  },

  removeResume(id) {
    this.state.resume = this.resumeList().filter((r) => r.id !== id);
    this.save();
  },

  clearResume() {
    this.state.resume = [];
    this.save();
  },

  queueList() {
    return Array.isArray(this.state.queue) ? this.state.queue : [];
  },

  inQueue(id) {
    return this.queueList().some((v) => v.id === id);
  },

  addToQueue(video, source = '') {
    if (!video || !video.id) return false;
    const entry = {
      id: video.id,
      title: video.title || 'YouTube video',
      channel: video.channel || 'YouTube',
      thumb: video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`,
      length: video.length || '',
      source,
    };
    // Native clients (LibreTube PlayingQueue.add) move an existing copy to the
    // tail instead of silently doing nothing.
    this.state.queue = [...this.queueList().filter((v) => v.id !== video.id), entry].slice(-30);
    this.save();
    return true;
  },

  removeFromQueue(id) {
    const list = this.queueList();
    if (!list.some((v) => v.id === id)) return false;
    this.state.queue = list.filter((v) => v.id !== id);
    this.save();
    return true;
  },

  clearQueue() {
    this.state.queue = [];
    this.save();
  },

  /** Repeat cycle follows NewPipe: Off -> One -> All -> Off. */
  repeatMode() {
    return ['off', 'one', 'all'].includes(this.state.repeatMode) ? this.state.repeatMode : 'off';
  },

  cycleRepeat() {
    const order = ['off', 'one', 'all'];
    const next = order[(order.indexOf(this.repeatMode()) + 1) % order.length];
    this.state.repeatMode = next;
    this.save();
    return next;
  },

  /* Content filters: hide videos by keyword or channel. */
  hiddenKeywords() {
    return Array.isArray(this.state.hiddenKeywords)
      ? this.state.hiddenKeywords.filter((k) => typeof k === 'string' && k)
      : [];
  },

  hiddenChannels() {
    return Array.isArray(this.state.hiddenChannels)
      ? this.state.hiddenChannels.filter((k) => typeof k === 'string' && k)
      : [];
  },

  addHiddenKeyword(keyword) {
    const value = String(keyword || '').trim().slice(0, 60);
    if (!value) return null;
    if (this.hiddenKeywords().some((k) => k.toLowerCase() === value.toLowerCase())) return null;
    this.state.hiddenKeywords = [...this.hiddenKeywords(), value];
    this.save();
    return value;
  },

  removeHiddenKeyword(keyword) {
    this.state.hiddenKeywords = this.hiddenKeywords().filter((k) => k !== keyword);
    this.save();
  },

  addHiddenChannel(channel) {
    const value = String(channel || '').trim().slice(0, 120);
    if (!value) return null;
    if (this.hiddenChannels().some((c) => c.toLowerCase() === value.toLowerCase())) return null;
    this.state.hiddenChannels = [...this.hiddenChannels(), value];
    this.save();
    return value;
  },

  removeHiddenChannel(channel) {
    this.state.hiddenChannels = this.hiddenChannels().filter((c) => c !== channel);
    this.save();
  },

  /** True when a YouTube result should be filtered out. */
  isFiltered(video) {
    if (!video) return false;
    const title = String(video.title || '').toLowerCase();
    const channel = String(video.channel || '').toLowerCase();
    if (this.hiddenChannels().some((c) => channel === c.toLowerCase())) return true;
    return this.hiddenKeywords().some((k) => title.includes(k.toLowerCase()));
  },

  isShuffle() { return !!this.state.shuffle; },
  toggleShuffle() {
    this.state.shuffle = !this.state.shuffle;
    this.save();
    return this.state.shuffle;
  },

  /* Subtitles/captions: off by default, toggled from the player controls. */
  captionsEnabled() { return !!this.state.captions; },
  setCaptions(on) {
    this.state.captions = !!on;
    this.save();
    return this.state.captions;
  },
  toggleCaptions() {
    return this.setCaptions(!this.state.captions);
  },

  /* Account mode: when set, next videos are restricted to this channel. */
  accountFilter() {
    const f = this.state.accountFilter;
    return f && typeof f.id === 'string' && f.id ? f : null;
  },

  setAccountFilter(id, name) {
    if (!id) return;
    this.state.accountFilter = { id: String(id), name: String(name || id).slice(0, 120) };
    this.save();
  },

  clearAccountFilter() {
    this.state.accountFilter = null;
    this.save();
  },

  /** Drops videos that were queued from an account page. */
  clearAccountQueue(name = '') {
    const before = this.queueList();
    const lower = String(name || '').toLowerCase();
    const kept = before.filter((v) => {
      if (String(v.source || '').startsWith('account:')) return false;
      // Older builds did not tag queue entries; match by channel name too.
      if (lower && String(v.channel || '').toLowerCase() === lower) return false;
      return true;
    });
    if (kept.length === before.length) return 0;
    this.state.queue = kept;
    this.state.nextCursor = 0;
    this.save();
    return before.length - kept.length;
  },

  /** Adds several videos in one write; returns how many were new. */
  addManyToQueue(videos, source = '') {
    let added = 0;
    const list = this.queueList();
    const seen = new Set(list.map((v) => v.id));
    for (const video of videos || []) {
      if (!video?.id || seen.has(video.id)) continue;
      seen.add(video.id);
      list.push({
        id: video.id,
        title: String(video.title || 'YouTube video').slice(0, 220),
        channel: String(video.channel || 'YouTube').slice(0, 120),
        thumb: video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`,
        length: String(video.length || ''),
        source,
      });
      added += 1;
    }
    this.state.queue = list.slice(-30);
    this.save();
    return added;
  },

  /**
   * Inserts a video so it plays next. A cursor keeps repeated "Play next"
   * clicks in click order instead of reversing them (REA finding).
   */
  playNextVideo(video, source = '') {
    if (!video?.id) return false;
    const without = this.queueList().filter((v) => v.id !== video.id);
    const cursor = Math.min(Number(this.state.nextCursor) || 0, without.length);
    without.splice(cursor, 0, {
      id: video.id,
      title: video.title || 'YouTube video',
      channel: video.channel || 'YouTube',
      thumb: video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`,
      length: video.length || '',
      source,
    });
    this.state.queue = without.slice(0, 30);
    this.state.nextCursor = cursor + 1;
    this.save();
    return true;
  },

  resetNextCursor() {
    this.state.nextCursor = 0;
    this.save();
  },

  /* ------------------------------------------------ YouTube library */

  ytHistoryList() {
    return Array.isArray(this.state.ytHistory)
      ? this.state.ytHistory.filter((v) => v && v.id && v.title)
      : [];
  },

  addYtHistory(video) {
    const entry = ytEntry(video);
    if (!entry) return null;
    entry.at = Date.now();
    const list = this.ytHistoryList();
    const prev = list.find((v) => v.id === entry.id);
    if (prev) {
      if (entry.title === 'YouTube video' && prev.title) entry.title = prev.title;
      if (!entry.channel && prev.channel) entry.channel = prev.channel;
      if (!entry.length && prev.length) entry.length = prev.length;
    }
    const rest = list.filter((v) => v.id !== entry.id);
    this.state.ytHistory = [entry, ...rest].slice(0, 200);
    this.save();
    return entry;
  },

  removeYtHistory(id) {
    this.state.ytHistory = this.ytHistoryList().filter((v) => v.id !== id);
    this.save();
  },

  clearYtHistory() {
    this.state.ytHistory = [];
    this.save();
  },

  isYtLiked(id) {
    return this.ytLikedList().some((v) => v.id === id);
  },

  ytLikedList() {
    return Array.isArray(this.state.ytLiked)
      ? this.state.ytLiked.filter((v) => v && v.id && v.title)
      : [];
  },

  toggleYtLike(video) {
    if (!video?.id) return false;
    const list = this.ytLikedList();
    if (list.some((v) => v.id === video.id)) {
      this.state.ytLiked = list.filter((v) => v.id !== video.id);
      this.save();
      return false;
    }
    this.state.ytLiked = ytUpsert(list, video);
    this.save();
    return true;
  },

  isYtSaved(id) {
    return this.ytSavedList().some((v) => v.id === id);
  },

  ytSavedList() {
    return Array.isArray(this.state.ytSaved)
      ? this.state.ytSaved.filter((v) => v && v.id && v.title)
      : [];
  },

  toggleYtSave(video) {
    if (!video?.id) return false;
    const list = this.ytSavedList();
    if (list.some((v) => v.id === video.id)) {
      this.state.ytSaved = list.filter((v) => v.id !== video.id);
      this.save();
      return false;
    }
    this.state.ytSaved = ytUpsert(list, video);
    this.save();
    return true;
  },

  playlistsList() {
    return Array.isArray(this.state.playlists)
      ? this.state.playlists.filter((p) => p && p.id && p.name)
      : [];
  },

  playlistById(id) {
    return this.playlistsList().find((p) => p.id === id) || null;
  },

  createPlaylist(name) {
    const value = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!value) return null;
    const list = this.playlistsList();
    if (list.length >= 20) return null;
    if (list.some((p) => p.name.toLowerCase() === value.toLowerCase())) return null;
    const playlist = {
      id: `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: value,
      at: Date.now(),
      items: [],
    };
    this.state.playlists = [...list, playlist];
    this.save();
    return playlist;
  },

  deletePlaylist(id) {
    this.state.playlists = this.playlistsList().filter((p) => p.id !== id);
    this.save();
  },

  inPlaylist(id, videoId) {
    const playlist = this.playlistById(id);
    return !!playlist?.items?.some((v) => v.id === videoId);
  },

  addToPlaylist(playlistId, video) {
    const playlist = this.playlistById(playlistId);
    if (!playlist || !video?.id) return false;
    const items = Array.isArray(playlist.items) ? playlist.items : [];
    if (items.some((v) => v.id === video.id)) return false;
    const entry = ytEntry(video);
    if (!entry) return false;
    playlist.items = [entry, ...items].slice(0, 200);
    playlist.at = Date.now();
    this.save();
    return true;
  },

  removeFromPlaylist(playlistId, videoId) {
    const playlist = this.playlistById(playlistId);
    if (!playlist) return false;
    const items = Array.isArray(playlist.items) ? playlist.items : [];
    if (!items.some((v) => v.id === videoId)) return false;
    playlist.items = items.filter((v) => v.id !== videoId);
    this.save();
    return true;
  },

  /* Fill in real titles/metadata after /api/video catches up, without
     disturbing whether an item is liked, saved or in a playlist. */
  refreshYtItem(video) {
    const entry = ytEntry(video);
    if (!entry) return;
    const merge = (item) => {
      if (!item || item.id !== entry.id) return item;
      return {
        ...item,
        title: entry.title === 'YouTube video' && item.title ? item.title : entry.title,
        channel: entry.channel || item.channel,
        thumb: entry.thumb || item.thumb,
        length: entry.length || item.length || '',
      };
    };
    this.state.ytLiked = this.ytLikedList().map(merge);
    this.state.ytSaved = this.ytSavedList().map(merge);
    this.state.playlists = this.playlistsList().map((playlist) => ({
      ...playlist,
      items: (Array.isArray(playlist.items) ? playlist.items : []).map(merge),
    }));
    this.save();
  },
};
