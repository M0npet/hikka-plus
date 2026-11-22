// Парсер manga.in.ua (рушій DLE). Логіка запитів частково взята з Hikka Features
// (rosset-nocpes/hikka-features, MIT) і переписана на DOMParser.
import { titleNames } from '../core/hikka';
import { getDoc, getText } from '../core/net';
import { bestSimilarity } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

const SITE = 'https://manga.in.ua';
const EP_CHAPTERS = 'engine/ajax/controller.php?mod=load_chapters';
const EP_IMAGES = 'engine/ajax/controller.php?mod=load_chapters_image';
const abs = (href: string) => (href.startsWith('http') ? href : `${SITE}/${href.replace(/^\//, '')}`);

function userHash(html: string): string {
  const m = html.match(/site_login_hash\s*=\s*'([^']+)'/);
  if (!m?.[1]) throw new Error('manga.in.ua: не знайдено site_login_hash');
  return m[1];
}

/** Ім'я параметра з хешем у конкретному AJAX-виклику (сайт його змінює). */
function hashKey(html: string, endpoint: string): string {
  const esc = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = html.match(new RegExp(`${esc}.*?{(.*?)}`, 's'))?.[1];
  const key = block?.match(/["']?([a-zA-Z0-9_]+)["']?\s*:\s*["']?(site_login_hash|dle_user_hash)["']?/)?.[1];
  if (key && key !== 'site_login_hash' && key !== 'dle_user_hash') return key;
  return html.includes('dle_user_hash') ? 'dle_user_hash' : 'user_hash';
}

function parseDate(s: string): number | undefined {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : undefined;
}

export const mangaInUa: ReadSource = {
  id: 'mangainua',
  name: 'Manga.in.ua',
  kinds: ['manga'],

  async search(query) {
    const form = new URLSearchParams({ do: 'search', subaction: 'search', story: query.trim(), search_start: '1' });
    const doc = await getDoc(`${SITE}/index.php?do=search`, { form });
    return [...doc.querySelectorAll('main.main article.item')].flatMap((art) => {
      const a = art.querySelector('h3.card__title a');
      const href = a?.getAttribute('href');
      if (!href) return [];
      const img = art.querySelector('img');
      const src = img?.getAttribute('data-src') || img?.getAttribute('src');
      return [
        {
          id: abs(href),
          title: a?.textContent?.trim() ?? '',
          altTitles: [],
          cover: src ? abs(src) : undefined,
          format: 'manga' as const,
          url: abs(href),
        },
      ];
    });
  },

  async autoMatch(title) {
    const link = title.external.find((e) => /manga\.in\.ua\//.test(e.url));
    if (link) return this.getTitle(link.url);
    const names = titleNames(title);
    let best: { t: RemoteTitle; score: number } | null = null;
    for (const q of names.slice(0, 2)) {
      const found = await this.search(q, 'manga').catch(() => []);
      for (const t of found.slice(0, 10)) {
        const score = bestSimilarity([t.title.replace(/^\([^)]*\)\s*/, '')], names);
        if (!best || score > best.score) best = { t, score };
      }
      if (best && best.score >= 0.98) break;
    }
    return best && best.score >= 0.85 ? best.t : null;
  },

  async getTitle(id) {
    const doc = await getDoc(abs(id));
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    return { id: abs(id), title: h1 ?? id, altTitles: [], cover: og ? abs(og) : undefined, format: 'manga', url: abs(id) };
  },

  async getChapters(id) {
    const html = await getText(abs(id));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const box = doc.querySelector<HTMLElement>('div#linkstocomics');
    if (!box) return [];
    const form = new URLSearchParams({
      action: 'show',
      news_id: box.dataset.news_id ?? '',
      news_category: box.dataset.news_category ?? '',
      this_link: box.dataset.this_link ?? '',
      [hashKey(html, EP_CHAPTERS)]: userHash(html),
    });
    const list = await getDoc(`${SITE}/${EP_CHAPTERS}`, { form });
    const out: Chapter[] = [];
    for (const el of list.querySelectorAll<HTMLElement>('div.ltcitems')) {
      const a = el.querySelector('a');
      const href = a?.getAttribute('href') ?? '';
      const text = a?.textContent?.trim() ?? '';
      if (!href || text.includes('Альтернативний')) continue;
      const name = text.includes(' - ') ? text.split(' - ').slice(1).join(' - ').trim() : '';
      const volume = el.getAttribute('manga-tom');
      out.push({
        id: href.split('/').pop()?.split('-')[0] || el.getAttribute('manga-chappter') || href,
        volume: volume && volume !== '0' ? volume : null,
        number: el.getAttribute('manga-chappter') ?? '0',
        name: name || undefined,
        team: el.getAttribute('translate') || undefined,
        date: parseDate(el.children[0]?.textContent ?? ''),
        url: abs(href),
      });
    }
    const n = (s: string | null) => Number.parseFloat((s ?? '0').replace(',', '.')) || 0;
    return out.sort((a, b) => n(a.volume) - n(b.volume) || n(a.number) - n(b.number));
  },

  async getContent(chapter) {
    const html = await getText(chapter.url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const params = new URLSearchParams({
      news_id: doc.querySelector<HTMLElement>('div#comics')?.dataset.news_id ?? '',
      action: 'show',
      [hashKey(html, EP_IMAGES)]: userHash(html),
    });
    const imgs = await getDoc(`${SITE}/${EP_IMAGES}&${params}`);
    const urls = [...imgs.querySelectorAll('img')]
      .map((i) => i.getAttribute('data-src'))
      .filter((x): x is string => !!x)
      .map(abs);
    if (!urls.length) throw new Error('Сторінки розділу не знайдено на manga.in.ua');
    return { type: 'images', pages: urls.map((u, i) => ({ id: `${i}`, url: () => u })) };
  },
};
