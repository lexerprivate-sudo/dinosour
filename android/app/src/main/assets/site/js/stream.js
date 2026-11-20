/* Attaches either a plain MP4 or an HLS playlist to a <video>.
 *
 * Browsers with native HLS (Safari/iOS) get the playlist directly. Everyone
 * else lazy-loads hls.js from /js/vendor/ only when an HLS video is played, so
 * the home page never pays for it.
 */

let loader = null;

function loadHls() {
  if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/js/vendor/hls.min.js';
    script.async = true;
    script.onload = () => resolve(globalThis.Hls);
    script.onerror = () => reject(new Error('hls.js failed to load'));
    document.head.append(script);
  });
  return loader;
}

export async function attachStream(video, src, { onFatal } = {}) {
  if (!/\.m3u8(\?|#|$)/i.test(src)) {
    video.src = src;
    return null;
  }

  // ?hlsjs=1 forces the hls.js path, which is otherwise skipped on Safari.
  const forceHls = new URLSearchParams(location.search).has('hlsjs');
  if (!forceHls && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    return null;
  }

  try {
    const Hls = await loadHls();
    if (!Hls?.isSupported()) {
      video.src = src;
      return null;
    }

    const hls = new Hls({
      enableWorker: true,
      backBufferLength: 30,
      maxBufferLength: 30,
    });
    let recovered = false;

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (!recovered) {
        recovered = true;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.destroy();
        return;
      }
      try {
        hls.destroy();
      } catch { /* already gone */ }
      onFatal?.(data);
    });

    hls.loadSource(src);
    hls.attachMedia(video);
    return hls;
  } catch {
    // No hls.js (offline, blocked): let the browser try the playlist itself.
    video.src = src;
    return null;
  }
}

export function detachStream(hls) {
  if (!hls) return;
  try {
    hls.destroy();
  } catch { /* noop */ }
}
