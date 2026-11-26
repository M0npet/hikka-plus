/*
 * Підмінений інтернет для E2E плеєра: hikka.io (сторінка тайтлу), api.hikka.io, публічний API Mikai
 * (api.mikai.me/public/v1/anime/hikka:<slug>/player), AnimeFillerList (типи серій) і фейковий плеєр Fenix (fenixplay.xyz).
 * Тайтли: SLUG — короткий з сиквелом; LONG — 26 серій без франшизи (типи серій з AFL, «Далі з Дивлюсь»);
 * MANGA — манґа на UAManga (читалка).
 * Усе інше — 404, у мережу тест не ходить.
 */
import type { BrowserContext, Route } from '@playwright/test';

export const SLUG = 'frieren-test';
export const SEQUEL = 'frieren-2-test';
export const TEAM = 'Тестова команда';
export const EP_TITLES = { 1: 'Кінець подорожі', 2: "It Didn't Have to Be Magic" } as const;
export const LONG = 'one-piece-test';
export const LONG_EPS = 26;
/** Хто зайшов на Hikka (local:hp:me) і наступний тайтл з його «Дивлюсь». */
export const USER = 'tester';
export const UP_NEXT = { slug: 'next-test', title: 'Наступне аніме', ep: 4 } as const;
/** Типи серій на AFL для LONG (решта — канон манґи, без позначки). */
export const LONG_KINDS = { 4: 'anime_canon', 5: 'anime_canon', 6: 'mixed_canon/filler', 7: 'filler', 8: 'filler' } as const;

/** Розмітка, якою Hikka підписує сторінку тайтлу (якоря наших блоків — як на справжній). */
const hikkaPage = (path: string) => `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"><title>Hikka (мок)</title></head>
<body><script>
  // Роутер TanStack, як у Hikka (window.__TSR_ROUTER__): міст розширення переходить ним без перезавантаження.
  window.__nav = [];
  window.__TSR_ROUTER__ = { navigate: (o) => { window.__nav.push(o.to); history.pushState({}, '', o.to); return Promise.resolve(); } };
</script><style>
  /* Як у Hikka: на широкому — дві колонки, на телефоні (< lg) — одна, на всю ширину з відступами 16 px. */
  main { display: grid; grid-template-columns: 1fr 3fr; gap: 16px; max-width: 1280px; margin: auto; padding: 0 16px; }
  @media (max-width: 1023px) { main { grid-template-columns: 1fr; } }
</style><main>
  <div id="content-left-side"><div><button>Додати у список</button></div></div>
  <div id="content-center">
    <h1>${path}</h1>
    <div id="content-description"><h3>Опис</h3><p>Мок сторінки тайтлу для E2E.</p></div>
    <div id="content-characters"><h3>Головні персонажі</h3></div>
  </div>
</main></body></html>`;

/** Фейковий Fenix: шле {fenix:true, event, time, duration}; тест керує часом через window.__tick(t). */
const fenixPage = `<!doctype html><html><body style="margin:0;background:#000;color:#fff;font:14px sans-serif">
<div id="hp-fake">Fenix (мок)</div>
<script>
  const DUR = 1440;
  const send = (event, time) => parent.postMessage({ fenix: true, event, time, duration: DUR }, '*');
  // «Відтворення» з позиції t: timeupdate 4 рази на секунду, як у справжнього плеєра.
  let timer = 0;
  window.__tick = (t) => { clearInterval(timer); let x = t; send('timeupdate', x); timer = setInterval(() => send('timeupdate', (x += 0.25)), 250); };
  window.__seeks = [];
  addEventListener('message', (e) => { window.__seeks.push(e.data); });
  send('ready', 0);
  send('loaded', 0);
</script></body></html>`;

const anime = {
  slug: SLUG,
  title_ua: 'Фрірен, що проводжає в останню путь',
  title_en: 'Frieren: Beyond Journey’s End',
  title_ja: 'Sousou no Frieren',
  mal_id: 52991,
  episodes_total: 2,
  episodes_released: 2,
  external: [],
};

const episodes = {
  pagination: { page: 1, pages: 1, total: 2 },
  list: [
    { index: 1, title_ua: EP_TITLES[1], title_en: 'The Journey’s End', title_ja: null, aired: null },
    { index: 2, title_ua: null, title_en: EP_TITLES[2], title_ja: null, aired: null },
  ],
};

const franchise = {
  relations: [{ slug: SLUG, related_slug: SEQUEL, relation_type: 'sequel', content_type: 'anime', related_content_type: 'anime' }],
  anime: [
    { ...anime, status: 'finished' },
    { slug: SEQUEL, title_ua: 'Фрірен 2', title_en: 'Frieren 2', title_ja: 'Sousou no Frieren 2', status: 'ongoing' },
  ],
  manga: [],
  novel: [],
};

const mikaiPlayer = {
  ok: true,
  result: {
    anime: { ids: { mikai: 1, slug: 'frieren', hikka: SLUG } },
    licensed: false,
    license: null,
    releases: [
      {
        id: 't_5:voice',
        kind: 'voice',
        teams: [{ id: 5, name: TEAM, avatar: null }],
        episodes: [1, 2].map((n) => ({ number: n, sources: [{ provider: 'fenix', embedUrl: `https://fenixplay.xyz/vod/test-${n}` }] })),
      },
    ],
  },
};

const long = {
  slug: LONG,
  title_ua: 'Ван Піс',
  title_en: 'One Piece',
  title_ja: 'One Piece',
  mal_id: null,
  status: 'finished',
  episodes_total: LONG_EPS,
  episodes_released: LONG_EPS,
  external: [],
};

const longPlayer = {
  ok: true,
  result: {
    anime: { ids: { mikai: 2, slug: 'one-piece', hikka: LONG } },
    licensed: false,
    license: null,
    releases: [
      {
        id: 't_5:voice',
        kind: 'voice',
        teams: [{ id: 5, name: TEAM, avatar: null }],
        episodes: Array.from({ length: LONG_EPS }, (_, i) => ({ number: i + 1, sources: [{ provider: 'fenix', embedUrl: `https://fenixplay.xyz/vod/op-${i + 1}` }] })),
      },
    ],
  },
};

/** /shows AFL: приманки перед справжнім шоу — «One Pace (One Piece)» (збіг лише в дужках) і фільми. */
const aflShows = `<!doctype html><html><body><div id="ShowList"><ul>
  <li><a href="/shows/one-pace">One Pace (One Piece)</a></li>
  <li><a href="/shows/one-piece-movies">One Piece Movies</a></li>
  <li><a href="/shows/one-piece">One Piece</a></li>
  ${Array.from({ length: 60 }, (_, i) => `<li><a href="/shows/show-${i}">Show ${i}</a></li>`).join('')}
</ul></div></body></html>`;

const aflShow = `<!doctype html><html><body><table class="EpisodeList"><tbody>
${Array.from({ length: LONG_EPS }, (_, i) => {
  const n = i + 1;
  const cls = (LONG_KINDS as Record<number, string>)[n] ?? 'manga_canon';
  return `<tr id="eps-${n}" class="${cls} odd"><td class="Number">${n}</td><td class="Title">Ep ${n}</td></tr>`;
}).join('')}
</tbody></table></body></html>`;

/** POST /watch/{USER}/list: поточний тайтл і вже переглянутий пропускаються. */
const watching = {
  pagination: { page: 1, pages: 1, total: 3 },
  list: [
    { episodes: 10, status: 'watching', anime: { slug: LONG, title_ua: 'Ван Піс', episodes_released: LONG_EPS, episodes_total: LONG_EPS } },
    { episodes: 12, status: 'watching', anime: { slug: 'done-test', title_ua: 'Усе переглянуто', episodes_released: 12, episodes_total: 12 } },
    { episodes: UP_NEXT.ep - 1, status: 'watching', anime: { slug: UP_NEXT.slug, title_ua: UP_NEXT.title, episodes_released: 7, episodes_total: 12 } },
  ],
};

/* ---------- Манґа (читалка): Hikka /manga/<slug> + UAManga JSON API ---------- */

export const MANGA = 'manga-test';
export const UA_SLUG = 'ua-test';
export const MANGA_CHAPTERS = 3;
export const MANGA_PAGES = 3;

const manga = {
  slug: MANGA,
  title_ua: 'Тестова манґа',
  title_en: 'Test Manga',
  title_original: 'Tesuto Manga',
  synonyms: [],
  media_type: 'manga',
  year: 2020,
  chapters: MANGA_CHAPTERS,
  external: [],
  mal_id: null,
};

const uaTitle = {
  slug: UA_SLUG,
  name: 'Тестова манґа',
  name_en: 'Test Manga',
  type: 'manga',
  chapter_count: MANGA_CHAPTERS,
  trackers: [{ code: 'hikka', url: `https://hikka.io/manga/${MANGA}` }],
};

/** Що «вийшло» на UAManga — тест нових розділів (chapters.spec.ts) додає розділ посеред тесту. */
/** hikkaWatch — запис тайтлу SLUG у списку Hikka (null — немає, 404 watch:not_found); hikkaPuts — тіла PUT /watch/SLUG. */
export const mockState = {
  mangaChapters: MANGA_CHAPTERS,
  hikkaWatch: null as Record<string, unknown> | null,
  hikkaPuts: [] as Record<string, unknown>[],
};

const uaChapters = () => ({
  pages: 1,
  items: Array.from({ length: mockState.mangaChapters }, (_, i) => ({ id: 100 + i, number: i + 1, name: `Том 1 Розділ ${i + 1}`, created_at: '2026-11-01T00:00:00Z' })),
});

const uaPages = (ch: string) => ({
  pages: Array.from({ length: MANGA_PAGES }, (_, i) => ({ index: i, url: `https://uamanga.com/img/${ch}-${i + 1}.svg`, width: 800, height: 1200 })),
});

/** Сторінка манґи: SVG 800×1200 з номером розділу й сторінки. */
const pageSvg = (name: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#ddd"/><text x="400" y="600" font-size="120" text-anchor="middle">${name}</text></svg>`;

/** Скільки разів сторінка/фон зверталися до кожного мок-адреса (для перевірок). */
export const hits = new Map<string, number>();

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

export async function installMock(context: BrowserContext) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const key = `${req.method()} ${u.host}${u.pathname}`;
    hits.set(key, (hits.get(key) ?? 0) + 1);

    if (u.protocol === 'chrome-extension:' || u.protocol === 'data:') return route.continue();
    if (u.host === 'hikka.io') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: hikkaPage(u.pathname) });
    if (u.host === 'fenixplay.xyz') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fenixPage });
    if (u.host === 'api.hikka.io') {
      if (u.pathname === `/anime/${SLUG}`) return json(route, anime);
      if (u.pathname === `/anime/${SLUG}/episodes`) return json(route, episodes);
      if (u.pathname === `/related/anime/${SLUG}/franchise`) return json(route, franchise);
      if (u.pathname === `/manga/${MANGA}`) return json(route, manga);
      if (u.pathname === `/anime/${LONG}`) return json(route, long);
      if (u.pathname === `/anime/${LONG}/episodes`) return json(route, { pagination: { page: 1, pages: 1, total: 0 }, list: [] });
      if (u.pathname === `/related/anime/${LONG}/franchise`) return json(route, { code: 'related:no-franchise' }, 400);
      if (u.pathname === `/watch/${USER}/list` && req.method() === 'POST') return json(route, watching);
      if (u.pathname === `/watch/${SLUG}`) {
        if (req.method() === 'PUT') {
          const body = req.postDataJSON() as Record<string, unknown>;
          mockState.hikkaPuts.push(body);
          mockState.hikkaWatch = body;
          return json(route, body);
        }
        return mockState.hikkaWatch ? json(route, mockState.hikkaWatch) : json(route, { code: 'watch:not_found', message: 'Not found' }, 404);
      }
      if (u.pathname === '/schedule/anime') return json(route, { pagination: { page: 1, pages: 1, total: 0 }, list: [] });
      return json(route, { code: 'mock:not-found' }, 404);
    }
    if (u.host === 'api.mikai.me') {
      if (u.pathname === `/public/v1/anime/hikka:${SLUG}/player`) return json(route, mikaiPlayer);
      if (u.pathname === `/public/v1/anime/hikka:${LONG}/player`) return json(route, longPlayer);
      return json(route, { ok: false }, 404);
    }
    if (u.host === 'uamanga.com') {
      if (u.pathname === `/api/titles/source/hikka/${MANGA}` || u.pathname === `/api/titles/${UA_SLUG}`) return json(route, uaTitle);
      if (u.pathname === `/api/titles/${UA_SLUG}/chapters`) return json(route, uaChapters());
      const ch = new RegExp(`^/api/titles/${UA_SLUG}/chapters/(\\d+)$`).exec(u.pathname);
      if (ch) return json(route, uaPages(ch[1]!));
      const img = /^\/img\/(\d+-\d+)\.svg$/.exec(u.pathname);
      if (img) return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: pageSvg(img[1]!) });
      return json(route, { error: 'not found' }, 404);
    }
    if (u.host === 'www.animefillerlist.com' || u.host === 'animefillerlist.com') {
      const html = (body: string) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
      if (u.pathname === '/shows') return html(aflShows);
      if (u.pathname === '/shows/one-piece') return html(aflShow);
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}
