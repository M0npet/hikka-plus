Notes to reviewer — Hikka Plus

WHAT IT DOES
Unofficial extension for hikka.io (Ukrainian anime/manga tracker). On hikka.io title pages it adds, inside its own Shadow DOM hosts (<hikka-plus-*>), a "Watch" block with embedded third-party players for anime and a "Chapters" block plus an overlay reader for manga/light novels from Ukrainian source sites. No server of our own, no analytics, no remote code. Interface is Ukrainian.

HOW TO TEST
1. Open any anime page from https://hikka.io/anime (a popular, already aired title) — the "Перегляд" (Watch) block appears below the description; pick an episode.
2. Open any manga page from https://hikka.io/manga — the "Розділи" (Chapters) block; click a chapter — the reader opens over the page. Light novels: https://hikka.io/novel.
3. Toolbar icon — settings window (tabs: Sources / Hikka / Reader / Player / Data).
Signing in to Hikka is optional (OAuth on hikka.io; any free Hikka account works). Without it everything except updating the Hikka list works.

SOURCE CODE / BUILD
Source archive is attached (same as the public repo https://github.com/M0npet/hikka-plus at this version's tag).
Requirements: Node.js 22, npm 10 (Ubuntu 24.04 or Windows 11).
  npm ci
  npm run build-for-amo        (= wxt build -b firefox; output: .output/firefox-mv2)
Built with WXT 0.21 (Vite/Rollup); React components are compiled against Preact (preact/compat alias in wxt.config.ts). All third-party code comes from npm via package-lock.json; no library is modified.
The Hikka OAuth client reference/secret are injected at build time from env WXT_HIKKA_CLIENT_REFERENCE / WXT_HIKKA_CLIENT_SECRET. Without them the build is identical except these two strings in background.js; the values are visible in the submitted background.js — set them as env vars for a byte-identical build. It is the OAuth client of a browser extension, so it is public by nature (anyone can read it from the package).

PERMISSIONS
- storage — settings, reading/watching progress, Hikka token (local only); sync storage for progress across the user's devices.
- https://hikka.io/* — content script that adds our blocks to title pages.
- https://api.hikka.io/* — title data (names, external links, MAL id); with the user's OAuth consent: read/update the user's read/watch list entry for the opened title. Plus the public episode schedule (POST /schedule/anime, no auth) every 3 h for card badges.
- Manga/novel sources (api.zenko.online, manga.in.ua, baka.in.ua, data/search.api.honey-manga.com.ua, uamanga.com, back.animesvit.com, dgmanga.app, runi.ink, api.smakolykytl.site, novel.org.ua, fan-vers.com, www.wattpad.com) — search by title name, chapter list, chapter pages/text. Requests go from the background script (CORS) with credentials: 'omit', only to an allowlist (src/core/hosts.ts, isAllowedUrl).
- Link-only sources (mangra.app, faust-web.com, mangarama.com.ua, manga.valsky.org) — public search to build a "read on <site>" link; nothing is read from them.
- api.mikai.me, animeon.club — list of dubs/episodes and player iframe URLs for the opened anime.
- api.aniskip.com — MAL id + episode number to find where the ending starts (the episode counts as watched from there).
- Content script in player iframes (ashdi.vip/vod/*, moonanime.art|net/iframe/*, fenixplay.xyz/*) — entrypoints/player-frame.content.ts. Runs only in our own iframe (window.name === 'hikka-plus') and only on request from https://hikka.io: draws the video into a 32×18 canvas ten times per second and posts the colours to hikka.io for the ambient glow around the player; when opening/ending marks are on, it also posts a 32-bit fingerprint of that small frame twice per second of video (compared locally on hikka.io to find the opening/ending shared by episodes; stored only in storage.local). The only thing it changes is video.currentTime — and only when the user clicks "Skip opening/ending" or the marks bar (or turned on auto-skip). It does not touch the player UI and does not extract streams. Cross-origin video without CORS → it reports "off" and stops.
  "Scan episodes ahead" (on by default, switch in the Player tab; skipped when navigator.connection reports saveData, 2g/3g or cellular): a second hidden iframe of the same player (window.name === 'hikka-plus-scan', 160×90, opacity 0.01, under our player) for the same or the neighbouring episode; on request {sweep:{from,to,rate:16}} from https://hikka.io the script seeks to `from`, plays at 16× (browsers mute audio above 4×), posts the same 32-bit fingerprints and pauses at `to`; the iframe is then removed. Nothing else is sent; it only downloads the video like a normal playback.
- web_accessible_resources hikka-bridge.js (hikka.io only) — tiny script injected into the page context: after we update the Hikka list it invalidates the page's own React Query cache so Hikka's widget shows the new number; it also listens to that cache to read the current counter. It does not modify Hikka's DOM.
- "Lights off" adds our own <hikka-plus-dim> element (Shadow DOM) to body with four dark rectangles around the player; removed on click/Esc.
- OPTIONAL http://*/* and https://*/* (+ optional data collection "websiteContent") — experimental "device lighting" (off by default; Player tab). The address of the user's TV (Philips JointSpace), WLED controller or Hue bridge in the home network is typed by the user, so it is not known in advance. On "Connect" we call permissions.request for that one origin only (plus websiteContent consent), never for all URLs; Razer Chroma asks for http://localhost/* and https://chromasdk.io/* (Chroma REST SDK on ports 54235/54236). Only edge colours of the frame are sent, only to those user-entered local devices (src/lights/).

DATA COLLECTION (manifest data_collection_permissions)
required: browsingActivity (slug/names of the opened title go to Hikka API, sources, Mikai, AnimeON, AniSkip), authenticationInfo (Hikka OAuth token, stored locally, sent only to api.hikka.io), websiteActivity (read chapters / watched episodes written to the user's Hikka list).
optional: websiteContent (frame colours to the user's own lighting devices).
Full policy: PRIVACY.md (Ukrainian + English) in the source archive and repo.

LINTER WARNINGS
UNSAFE_VAR_ASSIGNMENT (innerHTML) come from preact/compat rendering dangerouslySetInnerHTML (chunks/mount*, content.js). Our only use is light-novel chapter text in src/features/reader/views.tsx, which is sanitized with DOMPurify right before rendering.

Third-party players (Ashdi, Moon, Fenix) are embedded as plain iframes exactly as on the source sites; their pages are not controlled by the extension and may contain their own ads.
