import { getDoc, getJson } from '../core/net';
import { autoMatchBy, chapterNum } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// UAManga: серверні сторінки + JSON-підказки пошуку (/api/suggest).
const SITE = 'https://uamanga.com';

interface USuggest {
  slug: string;
  name: string;
  name_en?: string | null;
  cover?: string | null;
  type?: string | null;
  chapter?: number | null;
}

const toRemote = (t: USuggest): RemoteTitle => ({
  id: t.slug,
  title: t.name.trim(),
  altTitles: t.name_en ? [t.name_en.trim()] : [],
  cover: t.cover ?? undefined,
  format: t.type && t.type !== 'manga' ? 'webtoon' : 'manga',
  url: `${SITE}/title/${t.slug}`,
});

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

  autoMatch(title) {
    return autoMatchBy(this, title, /uamanga\.com\/title\/([\w-]+)/);
  },

  async getTitle(id) {
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

  async getContent(chapter) {
    const doc = await getDoc(chapter.url);
    const urls = [...doc.querySelectorAll('img')]
      .map((i) => i.getAttribute('data-src') || i.getAttribute('src') || '')
      .filter((u) => /\/titles\/\d+\/ch-/.test(u));
    if (!urls.length) throw new Error('Не знайшов сторінок розділу на UAManga');
    return { type: 'images', pages: urls.map((u, i) => ({ id: String(i), url: () => new URL(u, SITE).href })) };
  },
};
