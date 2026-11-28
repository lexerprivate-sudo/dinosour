/* Native media session bridge: keeps audio alive when the app is backgrounded. */

let target = null;
let lastTitle = '';
let lastChannel = '';
let appVisible = true;

const api = () => (typeof window !== 'undefined' ? window.Dinosour : null);

export function isAppVisible() {
  return appVisible;
}

/* MainActivity calls this when the app goes to the background or comes back.
   YouTube can auto-pause a hidden embed, so the players use this signal to
   retry playVideo only while the app is actually backgrounded. */
export function setAppVisible(next) {
  const value = !!next;
  if (value === appVisible) return;
  appVisible = value;
  window.dispatchEvent(new CustomEvent('dinosour:appvisibility', { detail: { visible: value } }));
}

/* The watch page or the mini player registers itself here so that lock-screen
   and notification buttons can reach whichever player is actually on. */
export function setMediaTarget(next) {
  target = next || null;
}

export function clearMediaTarget(which) {
  if (!which || target === which) target = null;
}

/* Called by the players whenever playback starts, pauses or ends. Pausing
   keeps the notification alive so the lock screen can resume the video. */
export function reportMedia(playing, title, channel) {
  const bridge = api();
  if (!bridge || !bridge.mediaState) return;
  if (typeof title === 'string') lastTitle = title;
  if (typeof channel === 'string') lastChannel = channel;
  bridge.mediaState(playing, lastTitle, lastChannel);
}

export function stopMedia() {
  const bridge = api();
  if (bridge && bridge.mediaStop) bridge.mediaStop();
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = 'none'; } catch {}
  }
}

/* Web builds (localhost / deployed site) expose OS media keys and lock-screen
   controls through the Media Session API — NewPipe/LibreTube-style parity. */
let webSessionBound = false;
export function setupWebMediaSession(handlers, title, channel, artwork = '') {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  try {
    const meta = new MediaMetadata({
      title: title || 'dinosour',
      artist: channel || 'YouTube',
      album: 'dinosour',
      artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    session.metadata = meta;
    const actions = [
      ['play', handlers.play], ['pause', handlers.pause], ['stop', handlers.stop],
      ['previoustrack', handlers.prev], ['nexttrack', handlers.next],
    ];
    for (const [name, fn] of actions) {
      if (typeof fn === 'function') {
        try { session.setActionHandler(name, fn); } catch {}
      }
    }
    webSessionBound = true;
  } catch {}
}

export function updateWebMediaState(playing) {
  if (!webSessionBound || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
}

/* Commands from the native notification / lock screen. */
let lastStopAt = 0;
export function onMediaCommand(action) {
  if (action === 'play') target?.play?.();
  else if (action === 'pause') target?.pause?.();
  else if (action === 'next') target?.next?.();
  else if (action === 'stop') {
    // ACTION_STOP already ends in a native mediaStop() from the player; calling
    // it here too made the two sides ping-pong stop commands. Dedupe regardless.
    const now = Date.now();
    if (now - lastStopAt < 500) return;
    lastStopAt = now;
    target?.stop?.();
  }
}
