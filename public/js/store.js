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
  ytRate: 1,
  ytQuality: 'auto',
};

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
};
