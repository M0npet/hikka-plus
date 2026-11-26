/*
 * Підмінений інтернет для E2E плеєра: hikka.io (сторінка тайтлу), api.hikka.io, публічний API Mikai
 * (api.mikai.me/public/v1/anime/hikka:<slug>/player) і фейковий плеєр Fenix (fenixplay.xyz).
 * Усе інше — 404, у мережу тест не ходить.
 */
import type { BrowserContext, Route } from '@playwright/test';

export const SLUG = 'frieren-test';
export const SEQUEL = 'frieren-2-test';
export const TEAM = 'Тестова команда';
export const EP_TITLES = { 1: 'Кінець подорожі', 2: "It Didn't Have to Be Magic" } as const;

/** Розмітка, якою Hikka підписує сторінку тайтлу (якоря наших блоків — як на справжній). */
const hikkaPage = (path: string) => `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Hikka (мок)</title></head>
<body><script>
  // Роутер TanStack, як у Hikka (window.__TSR_ROUTER__): міст розширення переходить ним без перезавантаження.
  window.__nav = [];
  window.__TSR_ROUTER__ = { navigate: (o) => { window.__nav.push(o.to); history.pushState({}, '', o.to); return Promise.resolve(); } };
</script><main style="display:grid;grid-template-columns:1fr 3fr;gap:16px;max-width:1280px;margin:auto">
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
      if (u.pathname === '/schedule/anime') return json(route, { pagination: { page: 1, pages: 1, total: 0 }, list: [] });
      return json(route, { code: 'mock:not-found' }, 404);
    }
    if (u.host === 'api.mikai.me') {
      if (u.pathname === `/public/v1/anime/hikka:${SLUG}/player`) return json(route, mikaiPlayer);
      return json(route, { ok: false }, 404);
    }
    return route.fulfill({ status: 404, body: '' });
  });
}
