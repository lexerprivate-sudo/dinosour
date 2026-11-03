# Deploying dinosour

The app is static, and so is the video — as soon as it is cut into HLS
segments. That lets the **whole site, library included, run on Cloudflare Pages
for free, with no payment method and no bandwidth cap**.

Search is the one live piece: the small functions in `functions/` proxy YouTube
from the edge. Pages Functions are included in the free plan, and the browser
still only talks to the site's own origin.

## The recommended setup

**Cloudflare Pages, serving the app plus HLS video.**

| Why | Detail |
| --- | --- |
| No card | Pages is a true free plan. R2, by contrast, makes you add a payment method even for its free 10 GB. |
| Unlimited bandwidth | Pages does not meter requests or transfer. |
| Fits the file cap | Pages rejects files over **25 MiB**. `tools/hls.mjs` cuts each film into segments; the largest here is ~14 MB. |
| Fits the file count | Pages allows 20,000 files. This library is ~790. |
| Same origin | No CORS, no separate media host, and the player keeps working exactly as it does locally. |

### Deploy

```sh
npm install          # installs wrangler (deploy CLI only; the site stays dependency-free)
npm run login        # opens the browser once
npm run cloud        # HLS → pack → upload to Pages
```

It prints:

```
✓ live at https://dinosour.pages.dev
```

The project name is configurable: `npm run cloud -- --project your-name` (or set
`DINOSOUR_PROJECT`).

Re-running `npm run cloud` is safe. HLS folders that are newer than their MP4
are reused. `npm run cloud -- --force` rebuilds all of them;
`npm run cloud -- --skip-hls` redeploys only the app.

### What the command does

1. Checks that `wrangler` is logged in.
2. `tools/hls.mjs` turns each `media/<id>.mp4` into
   `media/hls/<id>/index.m3u8` + `segNNN.ts`. This is a **stream copy**
   (`-c copy`), so there is no re-encode and no quality loss.
3. `tools/pack.mjs --hls` copies the app, thumbnails and HLS folders into
   `dist/`, rewriting the catalog `src` to the playlist.
4. Creates the Pages project `dinosour` and deploys `dist/` together with the
   API functions in `functions/`.

The source catalog and MP4s are untouched, so `npm start` still streams the
originals from disk. Use `npm run preview` to serve the packed `dist/` exactly
as Pages will.

### Player support

`public/js/stream.js` plays plain MP4s and HLS playlists. Safari/iOS use native
HLS; other browsers lazy-load the vendored `hls.js` (Apache-2.0) only when a
video is watched. Hover previews go through the same helper.

The Download menu item is hidden for HLS videos — the deployed copy is a
playlist of segments, not one file. The local app still has the MP4s.

### Search functions

Three routes live in `functions/api/` and are shared with the local Node server:

| Route | Purpose |
| --- | --- |
| `/api/search?q=` | YouTube results, with `continuation` for the next page |
| `/api/suggest?q=` | YouTube autocomplete |
| `/api/video?id=` | Title, channel, views and description for a remote watch page |

`functions/_lib/youtube.js` calls YouTube's public InnerTube API, so no key or
Google Cloud project is needed. `public/_routes.json` limits the Functions to
`/api/*`, keeping every other request on the static asset path. Edge responses
are cached with the Cache API.

If YouTube ever blocks the request, search falls back to the Piped mirror in the
same file, and the client keeps the local-library results. Playback is a YouTube
embed in the browser, so it is unaffected by the server's IP.

## Optional: R2 for the MP4s

If you do have a card and prefer direct MP4 URLs, **Cloudflare R2** has zero
egress fees and a 10 GB free tier. `npm run cloud:r2` is already written:

```sh
npm run cloud:r2
```

That creates the `dinosour-media` bucket, uploads the MP4s, enables the bucket's
`r2.dev` URL, builds `dist/` with `--media-base`, and deploys Pages. Every file
stays on R2; Pages only ships the ~1.4 MB app.

For production traffic, attach a custom domain to the bucket and set
`DINOSOUR_MEDIA_BASE=https://media.example.com` first — `r2.dev` is rate-limited.
R2 requires a payment method at checkout even while usage stays inside the free
allowance.

## Other hosts

| Host | Verdict |
| --- | --- |
| **Cloudflare Pages + HLS** | **Best fit.** Free, unlimited bandwidth, no card, whole library. |
| Cloudflare Pages + R2 | Also excellent, but R2 needs a card. Direct MP4 URLs. |
| Netlify + HLS | Works: `npm run hls`, `node tools/pack.mjs --hls`, `netlify deploy --prod --dir=dist`. 100 GB/month cap. Netlify recommends files under 10 MB, so re-encode `earth-from-space` if you care. |
| Netlify, full MP4 library | Not practical: 1 GB deploy, files up to 140 MB, 100 GB/month. |
| Vercel Hobby | **No for the videos.** Static uploads are capped at 100 MB per deployment. App + external media would work, but Pages is strictly better here. |
| Cloudflare Pages, plain MP4 | Impossible: 25 MiB per-file hard limit. HLS is what makes Pages work. |
| GitHub Pages | 1 GB repo / 100 MB per file / 100 GB bandwidth. HLS would fit, but Pages is freer and faster. |
| Render / Sevalla static | 5–100 GB bandwidth. Usable for the app, not ideal for a 1 GB library. |
| Any VPS | Full control, but you pay for bandwidth and lose the CDN. |

## Netlify fallback

`netlify.toml` is included. The default build packs the full MP4 library, which
is only sensible as a local test. For a deployable site use HLS:

```sh
npm run hls
node tools/pack.mjs --hls
netlify deploy --prod --dir=dist
```

Netlify reads the `_redirects` and `_headers` files, so deep links and caching
work there too. Netlify does **not** run the Cloudflare Pages Functions, so on
Netlify the app falls back to local-library search unless you port
`functions/api/*` to Netlify Functions.

## What not to do

- Don't commit `raw/` — ~1.1 GB of source footage, never served.
- Don't commit `media/` (including `media/hls/`) to Git; it makes every clone slow.
- Don't deploy plain MP4s to Pages; the 25 MiB cap will reject the films.

`.gitignore` covers `raw/`, `media/`, `thumbs/`, `dist/`, `.netlify/`,
`.wrangler/` and the R2 upload state file.
