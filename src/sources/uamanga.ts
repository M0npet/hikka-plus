import { getDoc, getJson, HttpError, rethrowRateLimit } from '../core/net';
import { autoMatchBy, chapterNum } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// UAManga: JSON API (UAManga дозволили ним користуватись — MK 2026-11-25): пошук /api/suggest, тайтл /api/titles/<slug>
// (з `trackers` — посилання на Hikka й MAL, тож тайтл знаходимо точно), розділи /api/titles/<slug>/chapters,
// сторінки — /api/titles/<slug>/chapters/<номер> (UAManga додали й задокументували 2026-11-25: https://uamanga.com/api/docs/;
// ліцензовані тайтли анонімно — 403). Запасне — base64 у #reader-image-data, далі розбір HTML.
const SITE = 'https://uamanga.com';

interface USuggest {
  slug: string;
  name: string;
  name_en?: string | null;
  cover?: string | null;
  type?: string | null;
  chapter?: number | null;
}

interface UTitle {
  slug: string;
  name: string;
  name_en?: string | null;
  aliases?: string[] | null;
  cover?: string | null;
  type?: string | null;
  year?: number | null;
  chapter_count?: number | null;
  trackers?: { code?: string; url?: string }[] | null;
}

const getApiTitle = (slug: string) => getJson<UTitle>(`${SITE}/api/titles/${encodeURIComponent(slug)}`);

const fromApi = (t: UTitle): RemoteTitle => ({
  ...toRemote(t),
  altTitles: [t.name_en, ...(t.aliases ?? [])].filter((x): x is string => !!x?.trim()).map((x) => x.trim()),
  year: t.year ?? undefined,
  chapterCount: t.chapter_count ?? undefined,
});

/** Тайтл на UAManga сам посилається на цей тайтл Hikka (або на той самий MAL id). */
function sameAsHikka(t: UTitle, slug: string, mal: number | null): boolean {
  return (t.trackers ?? []).some(
    (x) =>
      (x.code === 'hikka' && new RegExp(`/(manga|novel)/${slug}(?:[/?#]|$)`).test(x.url ?? '')) ||
      (x.code === 'mal' && mal != null && new RegExp(`/manga/${mal}(?:[/?#]|$)`).test(x.url ?? '')),
  );
}

const toRemote = (t: USuggest): RemoteTitle => ({
  id: t.slug,
  title: t.name.trim(),
  altTitles: t.name_en ? [t.name_en.trim()] : [],
  cover: t.cover ?? undefined,
  format: t.type && t.type !== 'manga' ? 'webtoon' : 'manga',
  url: `${SITE}/title/${t.slug}`,
});

type UChapter = { id?: number; name?: string; number?: number | string; created_at?: string };

const toChapter = (slug: string, c: UChapter): Chapter | null => {
  const number = String(c.number ?? '').replace(',', '.');
  if (!number) return null;
  return {
    id: String(c.id ?? number),
    volume: c.name?.match(/Том\s*(\d+)/i)?.[1] ?? null,
    number,
    date: c.created_at ? Date.parse(c.created_at) : undefined,
    url: `${SITE}/title/${encodeURIComponent(slug)}/chapter-${number.replace('.', '-')}`,
  };
};

const chaptersPage = (slug: string, n: number) =>
  getJson<{ items?: UChapter[]; pages?: number }>(`${SITE}/api/titles/${encodeURIComponent(slug)}/chapters?page=${n}&perpage=100`);

async function chaptersApi(slug: string): Promise<Chapter[]> {
  // По 100 на сторінку (`perpage`, більше — 400; порада UAManga, MK 2026-11-25): у Martial Peak 3862 розділи → 39 запитів, а не 194.
  // Після першої сторінки відомо `pages` — решту беремо по 4 паралельно.
  const page = (n: number) => chaptersPage(slug, n);
  const first = await page(1);
  const pages = Math.min(first.pages ?? 1, 200);
  const all = [first];
  for (let n = 2; n <= pages; n += 4) {
    const batch = [n, n + 1, n + 2, n + 3].filter((x) => x <= pages);
    all.push(...(await Promise.all(batch.map(page))));
  }
  return all.flatMap((r) => (r.items ?? []).map((c) => toChapter(slug, c)).filter((c): c is Chapter => !!c));
}

/** «"W3si…"» → [{url, width, height}] → адреси сторінок (лише http/https). */
function decodePages(text: string): string[] {
  try {
    const b64 = JSON.parse(text) as unknown;
    if (typeof b64 !== 'string') return [];
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const arr = JSON.parse(json) as { url?: unknown }[];
    return Array.isArray(arr)
      ? arr.map((p) => (typeof p?.url === 'string' ? new URL(p.url, SITE).href : '')).filter((u) => /^https?:/.test(u))
      : [];
  } catch {
    return [];
  }
}

export const uaManga: ReadSource = {
  id: 'uamanga',
  name: 'UAManga',
  kinds: ['manga'],

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const res = await getJson<{ items: USuggest[] }>(`${SITE}/api/suggest?q=${encodeURIComponent(q)}`);
    return (res.items ?? []).map(toRemote);
  },

  async autoMatch(title) {
    // Найточніше — пошук UAManga за id трекера (/api/titles/source/hikka|mal/<id>, додали 2026-11-25; невідомий — 404).
    const bySource = [`hikka/${encodeURIComponent(title.slug)}`, ...(title.mal_id != null ? [`mal/${title.mal_id}`] : [])];
    for (const ref of bySource) {
      const t = await getJson<UTitle>(`${SITE}/api/titles/source/${ref}`).catch((e) => (rethrowRateLimit(e), null));
      if (t?.slug) return fromApi(t);
    }
    // Запасне — точний збіг за посиланням на Hikka/MAL у самому тайтлі UAManga (перші кандидати пошуку).
    const queries = [title.title_ua, title.title_en, title.title_original].filter((x): x is string => !!x?.trim()).slice(0, 2);
    const seen = new Set<string>();
    for (const q of queries) {
      const found = await this.search(q, title.kind).catch((e) => (rethrowRateLimit(e), [] as RemoteTitle[]));
      for (const c of found.slice(0, 3)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const t = await getApiTitle(c.id).catch((e) => (rethrowRateLimit(e), null));
        if (t && sameAsHikka(t, title.slug, title.mal_id)) return fromApi(t);
      }
    }
    return autoMatchBy(this, title, /uamanga\.com\/title\/([\w-]+)/);
  },

  async getTitle(id) {
    const t = await getApiTitle(id).catch(() => null);
    if (t?.slug) return fromApi(t);
    const doc = await getDoc(`${SITE}/title/${encodeURIComponent(id)}`);
    const name = doc.querySelector('h1')?.textContent?.trim() || id;
    const type = doc.querySelector('[data-type]')?.getAttribute('data-type') ?? 'manga';
    return toRemote({
      slug: id,
      name,
      cover: doc.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content,
      type,
    });
  },

  async getChapters(titleId) {
    // Новий сайт (2026-11): розділи — JSON /api/titles/<slug>/chapters, по 20 на сторінку.
    const fromApi = await chaptersApi(titleId).catch(() => null);
    if (fromApi?.length) return fromApi.sort((a, b) => chapterNum(a.number) - chapterNum(b.number));
    const doc = await getDoc(`${SITE}/title/${encodeURIComponent(titleId)}`);
    const out: Chapter[] = [];
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('a.chapter-link')) {
      const href = a.getAttribute('href') ?? '';
      const m = href.match(/\/chapter-([\w-]+)$/);
      if (!m?.[1]) continue;
      const label = a.querySelector('.chapter-link__num')?.textContent?.trim() ?? '';
      const number = label.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.') ?? m[1].replace('-', '.');
      const vol = label.match(/Том\s*(\d+)/i)?.[1] ?? null;
      const date = a.querySelector('time')?.getAttribute('datetime');
      out.push({
        id: m[1],
        volume: vol,
        number,
        date: date ? Date.parse(date) : undefined,
        url: new URL(href, SITE).href,
      });
    }
    return out.sort((a, b) => chapterNum(a.number) - chapterNum(b.number));
  },

  async getLatest(titleId) {
    // Перша сторінка — найновіші 100 розділів (UAManga віддає від останнього).
    const r = await chaptersPage(titleId, 1);
    return (r.items ?? []).map((c) => toChapter(titleId, c)).filter((c): c is Chapter => !!c);
  },

  async getContent(chapter) {
    // API сторінок: …/title/<slug>/chapter-12-5 → /api/titles/<slug>/chapters/12-5 → {pages: [{index, url, width, height}]}.
    const m = chapter.url.match(/\/title\/([^/?#]+)\/chapter-([\w-]+)/);
    if (m) {
      try {
        type UPage = { index?: number; url: string; width?: number; height?: number };
        const r = await getJson<{ pages?: Partial<UPage>[] }>(`${SITE}/api/titles/${m[1]}/chapters/${m[2]}`);
        const list = (r.pages ?? [])
          .filter((x): x is UPage => typeof x?.url === 'string' && /^https?:/.test(x.url))
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        // Розмір 0 — «невідомий» (так у документації UAManga).
        if (list.length)
          return { type: 'images', pages: list.map((x, i) => ({ id: String(i), url: () => x.url, w: x.width || undefined, h: x.height || undefined })) };
      } catch (e) {
        rethrowRateLimit(e);
        if (e instanceof HttpError && e.status === 403)
          throw new Error('Цей тайтл ліцензований — на UAManga його можна читати лише після входу на сайті.');
        /* інша помилка — пробуємо сторінку розділу */
      }
    }
    const doc = await getDoc(chapter.url);
    // Новий сайт: адреси сторінок — base64-JSON у <script id="reader-image-data"> (UAManga дозволили брати їх звідси — MK 2026-11-25).
    const data = doc.getElementById('reader-image-data')?.textContent;
    if (data) {
      const list = decodePages(data);
      if (list.length) return { type: 'images', pages: list.map((u, i) => ({ id: String(i), url: () => u })) };
    }
    const urls = [...doc.querySelectorAll('img')]
      .map((i) => i.getAttribute('data-src') || i.getAttribute('src') || '')
      .filter((u) => /\/titles\/\d+\/ch-/.test(u));
    if (!urls.length) throw new Error('Не знайшов сторінок розділу на UAManga');
    return { type: 'images', pages: urls.map((u, i) => ({ id: String(i), url: () => new URL(u, SITE).href })) };
  },
};
