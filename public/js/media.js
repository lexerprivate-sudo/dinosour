/* Native media session bridge: keeps audio alive when the app is backgrounded. */

let target = null;
let lastTitle = '';
let lastChannel = '';

const api = () => (typeof window !== 'undefined' ? window.Dinosour : null);

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
  if (title) lastTitle = title;
  if (channel) lastChannel = channel;
  bridge.mediaState(playing, lastTitle, lastChannel);
}

export function stopMedia() {
  const bridge = api();
  if (bridge && bridge.mediaStop) bridge.mediaStop();
}

/* Commands from the native notification / lock screen. */
export function onMediaCommand(action) {
  if (action === 'play') target?.play?.();
  else if (action === 'pause') target?.pause?.();
  else if (action === 'stop') {
    target?.stop?.();
    stopMedia();
  }
}
