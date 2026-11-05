# dinosour

A small video site with **real YouTube search** and a local, ad-free library.

Type anything into the search bar and get live results from YouTube. Every result
plays in YouTube's own player. The 28 films and clips bundled with the site stay
on your machine and play in the built-in, ad-free player. No account, no
subscriptions, no cookies of our own, no telemetry.

```
npm start
```

Then open <http://localhost:3000>.

---

## What's here

- **Home feed** — a responsive grid of long videos plus a horizontal **Shorts** rail.
- **Video page** — custom player, likes, save-to-watch-later, share, description,
  local comments, and a related-videos column.
- **Real search** — live YouTube results with infinite "show more", plus matches
  from the local library. Suggestions come from YouTube as you type.
- **YouTube playback** — remote results open on a video page with a click-to-play
  YouTube embed, channel, views and description.
- **Continue watching** — playback position is remembered per YouTube video and
  unfinished videos appear in a resume rail on Home, with a progress bar, time
  left, and a one-tap **Start over**.
- **Playback controls** — speed from 0.5× to 2× and a quality preference
  (YouTube still controls the final adaptive quality), remembered on the device.
- **Up Next & autoplay** — tap **+** on any related video to queue it. When a video
  ends, an end screen shows what plays next and counts down instead of stopping,
  with **Play now**, **Replay** and **Cancel**. Autoplay can be switched off, and
  the queue is remembered on the device.
- **Mini player** - leave the watch page while a video is playing and it keeps
  going in a floating corner player with title, progress, expand and close.
  Opening any video page takes over from it.
- **Background audio** - playback keeps its audio session alive when you leave the
  app or lock the screen, with play, pause and stop on the lock screen and in the
  notification shade. YouTube's embedded player may still pause itself when the
  screen is off; the media controls let you resume without reopening the app.
- **Your topics** — the home chips are whatever you add: type a topic and it
  becomes an endless YouTube feed. No fixed categories.
- **Library** — watch history, liked videos, and watch later, stored on your machine.
- **Channel pages** — no subscribe buttons anywhere, by design.
- **Light and dark themes**, collapsible sidebar, theater mode, keyboard shortcuts.

Everything is a plain HTML/CSS/JS front end. A ~380-line Node server serves it
locally and proxies YouTube so the browser never hits a CORS wall. The same routes
ship as Cloudflare Pages Functions in `functions/`. There is no build step and no
runtime dependency (`wrangler` is only for deploying — see [DEPLOY.md](DEPLOY.md)).

## Running it

Requirements: **Node.js 20 or newer**. That's it.

| Command | What it does |
| --- | --- |
| `npm start` | Starts the server and opens your browser |
| `npm run serve` | Starts the server without opening a browser |
| `npm run build` | Rebuilds `media/` + `thumbs/` from `raw/` (needs ffmpeg) |
| `npm run fetch` | Re-downloads the original source footage (needs internet) |
| `npm run hls` | Cuts the MP4s into HLS folders for static hosting |
| `npm run preview` | Serves the packed `dist/` locally, exactly as Pages will |
| `npm run login` | Connects the Cloudflare CLI, once |
| `npm run cloud` | Deploys the app + HLS video to Cloudflare Pages |

The default port is `3000`. If it is taken, the server walks up to the next free
port and prints the URL it picked. You can force one with `PORT=8123 npm run serve`.

Your watch history, likes, saved videos and preferences live in `localStorage`
under the key `dinosour.v1` (data from `watch.v1` and `tot.v1` is migrated once,
automatically). Deleting that key resets the app; nothing leaves the machine.

## How search works

`/api/search`, `/api/suggest` and `/api/video` are thin, cached proxies for
YouTube's public InnerTube API. No API key and no Google Cloud project are
needed. The browser calls the same origin, so there is no CORS setup.

- **Search** returns up to 20 videos per page with a continuation token; the
  results page keeps loading as you scroll.
- **Home** starts with the local library, then continues with YouTube results
  from related searches, endlessly.
- **Suggestions** come from YouTube's autocomplete endpoint.
- **Playback** is a YouTube embed. The app never proxies or downloads YouTube
  media.
- **Fallback** if YouTube is unreachable: the results page still shows matches
  from the local library, with a retry button.

Because remote results use YouTube's player, YouTube may show its own ads or
recommendations there. Everything hosted in `media/` plays without ads.

## Player shortcuts

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `J` / `L` | Back / forward 10 seconds |
| `←` / `→` | Back / forward 5 seconds |
| `↑` / `↓` | Volume up / down |
| `M` | Mute |
| `F` | Fullscreen |
| `T` | Theater mode |
| `0`–`9` | Jump to 0%–90% |
| `<` / `>` | Slower / faster playback |
| `Esc` | Close menus |

Progress is saved as you watch, so a video you leave half-finished resumes where
you stopped, with a "Start over" action in case you'd rather not.

## Adding your own videos

1. Put the file in `media/`, for example `media/my-clip.mp4`.
2. Put a thumbnail in `thumbs/`, for example `thumbs/my-clip.jpg` (16:9 for normal
   videos, 9:16 for shorts).
3. Add an entry to `public/data/catalog.json`:

```json
{
  "id": "my-clip",
  "title": "My clip",
  "channel": "blender",
  "category": "Animation",
  "short": false,
  "duration": 0,
  "views": 1200,
  "likes": 34,
  "published": "2026-10-31",
  "commentCount": 0,
  "src": "/media/my-clip.mp4",
  "thumb": "/thumbs/my-clip.jpg",
  "description": "What you're looking at.",
  "tags": ["demo"]
}
```

`duration` can stay `0` if you run `npm run build` afterwards — but that rebuilds
everything from `raw/`, so for a single hand-added file it is easier to just write
the real duration in seconds.

To add a channel, append to `channels` with a unique `id`, a `name`, and a `color`
used for the avatar.

If you drop a file into `raw/`, add a matching rule to `RULES` in
`tools/finalize.mjs`; then `npm run build` transcodes it to a web-friendly 720p MP4
and generates the thumbnail for you.

## Android app

`npm run mobile` builds `mobile/dinosour.apk` directly with the Android SDK —
JDK plus build-tools and platform 35, no Gradle. Install it with
`adb install -r mobile/dinosour.apk`, or copy the file to the phone and open it.

The APK is **fully standalone**. The whole site (`public/`) is bundled inside the
APK and loaded from a private `https://dinosour.local` origin. The YouTube
search, suggestions and metadata endpoints are answered in Java (`YouTubeApi`),
so the app needs no server, no local network, no Cloudflare and no deployment.
It works on Wi-Fi or mobile data in any country.

The app opens straight to the feed. Local-only features (the bundled film
library, history, likes and watch later) are hidden there, because those live on
the computer; the app is YouTube search, home and playback. The phone layout is
not the desktop layout squeezed down: it has full-bleed cards, side-by-side
search results, a sticky player, and a compact bottom bar.

The fixed category chips are gone. The home feed is built from **your topics**
instead: tap **Add topic**, type anything (football, cooking, lofi, …), and it
becomes a chip that drives an endless YouTube feed. Topics are stored on the
phone and survive updates. Settings also holds the update checker, the topic
manager, and the light/dark switch.

The APK is signed with the local debug key in `mobile/debug.keystore`. That is
fine for sideloading; do not publish it to a store.

### Updates

Updates are automatic. The app checks the latest GitHub release every time it
opens (and periodically while it is running), downloads a newer APK in the
background, and pops up an in-app dialog when it is ready. Tap **Install** and
Android shows its own confirmation; the update replaces the old app and keeps
your topics and settings. Choosing **Later** hides that version until you ask
again. **Settings → Check for updates** forces a check at any time.

Android does not allow a normal app to install silently: the system install
dialog always appears once, and Android asks once for permission to install
from dinosour. Nothing else is manual — no GitHub visit, no file copying.

Publish a release with:

```sh
npm run release            # 1.0.0 -> 1.0.1
npm run release -- minor   # 1.0.1 -> 1.1.0
```

That bumps `package.json`, builds the APK, pushes the version commit, creates a
tagged GitHub release, and uploads `dinosour.apk`. Keep the same signing key:
Android refuses updates signed with a different key.

## Deploying it

The whole site — app **and** video — fits on Cloudflare Pages' free plan if the
films are cut into HLS segments. Pages caps individual files at 25 MiB, but HLS
segments are a few MB and Pages does not cap bandwidth. No payment method is
needed.

```sh
npm install
npm run login     # one-time browser login
npm run cloud     # HLS → pack → upload
```

That prints a `https://dinosour.pages.dev` URL. The stream copy is lossless and
fast, and local development keeps using the original MP4s. Full details, the
optional R2/MP4 setup, and other hosts are in [DEPLOY.md](DEPLOY.md).

## Layout

```
server.js             zero-dependency static + range-request server
functions/            Cloudflare Pages Functions for /api/search, /api/suggest, /api/video
  _lib/youtube.js     YouTube search/metadata client shared with the local server
public/
  index.html          app shell and SVG icon sprite
  css/app.css         all styling, both themes, responsive rules
  js/
    app.js            router, header, search, hover previews
    views.js          page rendering and mounting
    player.js         the video player
    stream.js         MP4 / HLS source attachment
    yt.js             client for live YouTube search and metadata
    vendor/hls.min.js hls.js (Apache-2.0), loaded only for HLS playback
    components.js     cards, shorts, related items, empty states
    data.js           catalog loading, local search, related-video scoring
    store.js          localStorage state (likes, history, progress, comments)
    ui.js             toasts, floating menus, navigation
    util.js           formatting and small helpers
  data/catalog.json   channels, videos, seeded comments
media/                the videos themselves
thumbs/               generated thumbnails
raw/                  original downloads (not served)
tools/                download, transcode, and catalog utilities
mobile/               Android app (Java WebView shell) and APK output
tools/android.mjs     builds mobile/dinosour.apk without Gradle
```

## Footage and licensing

The bundled media is free to redistribute. Nothing here is ripped from YouTube;
remote results are played through YouTube's own embed and are never stored.

- **Big Buck Bunny**, **Sintel**, **Tears of Steel**, **Elephants Dream** —
  Blender Foundation open movies, licensed **CC BY 3.0**. Attribution: Blender
  Foundation / Blender Studio, <https://www.blender.org/about/projects/>.
- **NASA** footage — public domain, courtesy NASA / JPL-Caltech. Individual titles
  and sources are recorded in `data/sources.json`.
- **Pexels** clips — free to use under the Pexels license, no attribution required,
  <https://www.pexels.com/license/>.
- **hls.js** — Apache License 2.0, <https://github.com/video-dev/hls.js>. A copy of
  the license is in `public/js/vendor/hls.LICENSE`.
- **YouTube search data** — titles, thumbnails and metadata belong to their
  owners and are shown for search and playback, not redistributed.

If you publish this site anywhere, keep the Blender attribution and the CC BY
credit visible — that license requires it.

## Notes

- Videos are served with HTTP range support, so seeking is instant and the browser
  only downloads what it plays.
- Thumbnails are generated with ffmpeg at a fixed timestamp per source; hover
  previews stream a few seconds of the real file, muted. If your system asks for
  reduced motion, previews are off — add `?previews=1` to a URL to turn them on.
- The player has no analytics, no ads, no autoplay-with-sound. Autoplay-next waits
  six seconds and is off in one click. It is also remembered.
