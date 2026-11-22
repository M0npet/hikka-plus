// Парсер baka.in.ua. Логіка розбору сторінок частково взята з Hikka Features
// (rosset-nocpes/hikka-features, MIT) і переписана на DOMParser.
import { titleNames } from '../core/hikka';
import { getDoc } from '../core/net';
import { bestSimilarity } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

const SITE = 'https://baka.in.ua';
const abs = (href: string) => (href.startsWith('http') ? href : `${SITE}/${href.replace(/^\//, '')}`);
/** id тайтлу = шлях без домену, напр. /fictions/volodar-taiemnyts */
const pathOf = (href: string) => new URL(abs(href)).pathname;

function parseDate(s: string): number | undefined {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : undefined;
}

function parseRows(root: ParentNode, volume: string | null): Chapter[] {
  return [...root.querySelectorAll('li.group')].flatMap((li) => {
    const a = li.querySelector<HTMLAnchorElement>('a[href*="/chapters/"]');
    const href = a?.getAttribute('href');
    if (!href) return [];
    const number = li.querySelector('span')?.textContent?.trim() ?? '';
    const full = a?.querySelectorAll('span')[1]?.textContent?.trim() ?? '';
    const name = full.match(/^Розділ\s+\S+\s+[—-]\s+(.*)$/s)?.[1]?.trim();
    const team = [...li.querySelectorAll('a[href^="/scanlators"]')]
      .map((x) => x.textContent?.trim())
      .filter(Boolean)
      .join(', ');
    return [
      {
        id: pathOf(href),
        volume,
        number,
        name: name || undefined,
        team: team || undefined,
        date: parseDate(li.querySelector('p')?.textContent ?? ''),
        url: abs(href),
      },
    ];
  });
}

export const baka: ReadSource = {
  id: 'baka',
  name: 'Бака',
  kinds: ['novel'],

  async search(query) {
    const doc = await getDoc(`${SITE}/search?filter=fiction&search[]=${encodeURIComponent(query.trim())}`);
    return [...doc.querySelectorAll<HTMLAnchorElement>('#fictions-section .group a.block')].flatMap((a) => {
      const href = a.getAttribute('href');
      if (!href) return [];
      const texts = [...(a.parentElement?.querySelectorAll('h3, p') ?? [])]
        .map((e) => e.textContent?.trim() ?? '')
        .filter(Boolean);
      const img = (a.querySelector('img') ?? a.parentElement?.querySelector('img'))?.getAttribute('src');
      return [
        {
          id: pathOf(href),
          title: texts[0] ?? '',
          altTitles: texts.slice(1, 3),
          cover: img ? abs(img) : undefined,
          format: 'novel' as const,
          url: abs(href),
        },
      ];
    });
  },

  async autoMatch(title) {
    for (const ext of title.external) {
      if (/baka\.in\.ua\/fictions\//.test(ext.url)) return this.getTitle(pathOf(ext.url));
    }
    const names = titleNames(title);
    let best: { t: RemoteTitle; score: number } | null = null;
    for (const q of names.slice(0, 3)) {
      const found = await this.search(q, 'novel').catch(() => []);
      for (const t of found) {
        const score = bestSimilarity([t.title, ...t.altTitles], names);
        if (!best || score > best.score) best = { t, score };
      }
      if (best && best.score >= 0.98) break;
    }
    return best && best.score >= 0.8 ? best.t : null;
  },

  async getTitle(id) {
    const doc = await getDoc(abs(id));
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    return { id: pathOf(id), title: h1 ?? id, altTitles: [], cover: og ?? undefined, format: 'novel', url: abs(id) };
  },

  async getChapters(id) {
    const doc = await getDoc(abs(id));
    const out: Chapter[] = [];
    for (const acc of doc.querySelectorAll('.accordion')) {
      const head = acc.querySelector('.accordion-header h3')?.textContent?.trim() ?? '';
      const volume = head.match(/^Том\s+(\d+(?:[.,]\d+)?)/i)?.[1] ?? null;
      const pager = acc.querySelector('[data-chapter-group-pager-url-value]');
      const section =
        acc.querySelector('[data-chapter-section-url]')?.getAttribute('data-chapter-section-url') ||
        pager?.getAttribute('data-chapter-group-pager-url-value');
      const total = Number(pager?.getAttribute('data-chapter-group-pager-total-value') ?? 0);
      const loaded = acc.querySelectorAll('li.group').length;
      if (section && (!pager || loaded < total)) {
        const u = new URL(section, SITE);
        u.searchParams.set('limit', 'all');
        out.push(...parseRows(await getDoc(u.toString()), volume));
      } else {
        out.push(...parseRows(acc, volume));
      }
    }
    const n = (s: string | null) => Number.parseFloat((s ?? '0').replace(',', '.')) || 0;
    return out.sort((a, b) => n(a.volume) - n(b.volume) || n(a.number) - n(b.number));
  },

  async getContent(chapter) {
    const doc = await getDoc(chapter.url);
    const html = doc.querySelector('#user-content')?.innerHTML;
    if (!html) throw new Error('Не вдалося знайти текст розділу на Бака');
    return { type: 'text', html };
  },
};
