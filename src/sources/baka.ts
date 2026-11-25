// Парсер baka.in.ua. Логіка розбору сторінок частково взята з Hikka Features
// (rosset-nocpes/hikka-features, MIT) і переписана на DOMParser.
import { titleNames } from '../core/hikka';
import { getDoc, rethrowRateLimit } from '../core/net';
import { bestSimilarity, exactly, settleMatch } from './match';
import { renumberByVolume, type Chapter, type ReadSource, type RemoteTitle } from './types';

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

// Бака (Cloudflare) відповідає 429, якщо запитів забагато. Сторінку тайтлу просять одразу кілька частин
// (розділи, постер — getTitle, «нових розділів» — getLatest), тож тримаємо її хвилину й не качаємо вдруге.
const PAGE_TTL_MS = 60_000;
const pages = new Map<string, { at: number; doc: Promise<Document> }>();
function titlePage(id: string): Promise<Document> {
  const url = abs(id);
  const hit = pages.get(url);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.doc;
  const doc = getDoc(url);
  pages.set(url, { at: Date.now(), doc });
  doc.catch(() => pages.delete(url));
  for (const [k, v] of pages) if (Date.now() - v.at >= PAGE_TTL_MS) pages.delete(k);
  return doc;
}

const num = (s: string | null) => Number.parseFloat((s ?? '0').replace(',', '.')) || 0;

/** Розділи одного тому: що вже є на сторінці, а якщо не всі — один запит `chapter_section?limit=all`. */
async function volumeRows(acc: Element): Promise<Chapter[]> {
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
    return parseRows(await getDoc(u.toString()), volume);
  }
  return parseRows(acc, volume);
}

/** «Том 12 · Розділи 526–529» → том і перший розділ. */
function volumeHead(acc: Element): { vol: number; from: number } | null {
  const t = acc.querySelector('.accordion-header h3')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const m = t.match(/^Том\s+(\d+(?:[.,]\d+)?)\s*·\s*Розділи?\s+(\d+(?:[.,]\d+)?)/i);
  return m ? { vol: num(m[1]!), from: num(m[2]!) } : null;
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
      if (/baka\.in\.ua\/fictions\//.test(ext.url)) return exactly(await this.getTitle(pathOf(ext.url)));
    }
    const names = titleNames(title);
    let best: { t: RemoteTitle; score: number } | null = null;
    for (const q of names.slice(0, 3)) {
      const found = await this.search(q, 'novel').catch((e) => (rethrowRateLimit(e), []));
      for (const t of found) {
        const score = bestSimilarity([t.title, ...t.altTitles], names);
        if (!best || score > best.score) best = { t, score };
      }
      if (best && best.score >= 0.98) break;
    }
    return settleMatch(this, title, best);
  },

  async getTitle(id) {
    const doc = await titlePage(id);
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    return { id: pathOf(id), title: h1 ?? id, altTitles: [], cover: og ?? undefined, format: 'novel', url: abs(id) };
  },

  async getChapters(id) {
    const doc = await titlePage(id);
    const out: Chapter[] = [];
    // По одному тому за раз (не паралельно): у довгих тайтлів томів 10+, Бака на сплеск відповідає 429.
    for (const acc of doc.querySelectorAll('.accordion')) out.push(...(await volumeRows(acc)));
    return out.sort((a, b) => num(a.volume) - num(b.volume) || num(a.number) - num(b.number));
  },

  /**
   * Лише найновіший том — для плашки «▶ N нових розділів»: 1–2 запити замість 1 + кількість томів
   * («Початок після кінця» — 1 замість 11). Якщо нумерація в томах починається заново («Розділи 1–…» у кожному)
   * або заголовки не розібрати — усі розділи, як і раніше (номер рахує renumberByVolume).
   */
  async getLatest(id) {
    const doc = await titlePage(id);
    const accs = [...doc.querySelectorAll('.accordion')];
    const heads = accs.map(volumeHead);
    let last = -1;
    heads.forEach((h, i) => {
      if (h && (last < 0 || h.vol > heads[last]!.vol)) last = i;
    });
    const top = heads[last];
    const restarts = !top || heads.some((h, i) => !h || (i !== last && h.from >= top.from));
    if (restarts) return renumberByVolume(await this.getChapters(id));
    return volumeRows(accs[last]!);
  },

  async getContent(chapter) {
    const doc = await getDoc(chapter.url);
    const html = doc.querySelector('#user-content')?.innerHTML;
    if (!html) throw new Error('Не вдалося знайти текст розділу на Бака');
    return { type: 'text', html };
  },
};
