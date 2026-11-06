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
};

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

  addToQueue(video) {
    if (!video || !video.id) return false;
    if (this.inQueue(video.id)) return false;
    const entry = {
      id: video.id,
      title: video.title || 'YouTube video',
      channel: video.channel || 'YouTube',
      thumb: video.thumb || `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`,
      length: video.length || '',
    };
    this.state.queue = [...this.queueList(), entry].slice(-30);
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
