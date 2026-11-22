import { getJson } from '../core/net';
import { autoMatchBy, bestSimilarity } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// FanVers (fan-vers.com): переклади ранобе + авторські твори, JSON API (Django).
// Каталог невеликий і приходить одним запитом — шукаємо в ньому самі.
// Авторські книги (book_type AUTHOR) пропускаємо: у базі Hikka їх немає. Платні розділи — ні.
const SITE = 'https://fan-vers.com';
const API = `${SITE}/api/catalog/books`;

interface FBook {
  slug: string;
  title: string;
  title_en?: string | null;
  image?: string | null;
  book_type?: string;
  chapters_count?: number;
}
interface FChapter {
  title: string;
  slug: string;
  order: number;
  is_paid?: boolean;
  is_purchased?: boolean;
  volume_title?: string | null;
  created_at?: string;
}

let catalog: Promise<FBook[]> | null = null;
function loadCatalog(): Promise<FBook[]> {
  catalog ??= getJson<FBook[]>(`${API}/reader/`).then((all) => all.filter((b) => b.book_type !== 'AUTHOR'));
  catalog.catch(() => (catalog = null));
  return catalog;
}

const toRemote = (b: FBook): RemoteTitle => {
  // Укр. й англ. назви на сайті іноді переплутані місцями — беремо обидві.
  const names = [b.title, b.title_en ?? ''].map((s) => s.trim()).filter(Boolean);
  const uk = names.find((n) => /[а-яіїєґ]/i.test(n)) ?? names[0]!;
  return {
    id: b.slug,
    title: uk,
    altTitles: names.filter((n) => n !== uk),
    cover: b.image ?? undefined,
    format: 'novel',
    chapterCount: b.chapters_count,
    url: `${SITE}/books/${b.slug}`,
  };
};

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
/** «Том I» → «1», «Том 12» → «12». */
function volumeNo(t: string | null | undefined): string | null {
  const v = t?.replace(/^\s*(?:том|volume)\s*/i, '').trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return v;
  if (!/^[IVXLC]+$/i.test(v)) return v;
  let n = 0;
  const s = v.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN[s[i]!]!;
    const next = ROMAN[s[i + 1] ?? ''] ?? 0;
    n += cur < next ? -cur : cur;
  }
  return String(n);
}

const numRe = /(?:розділ|глава|chapter)[\s_]*(\d+(?:[.,]\d+)?)/i;

export const fanVers: ReadSource = {
  id: 'fanvers',
  name: 'FanVers',
  kinds: ['novel'],

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    return (await loadCatalog())
      .map(toRemote)
      .map((r) => ({ r, s: bestSimilarity([r.title, ...r.altTitles], [q]) }))
      .filter((x) => x.s >= 0.3)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /fan-vers\.com\/books\/([\w-]+)/);
  },

  async getTitle(id) {
    const b = (await loadCatalog()).find((x) => x.slug === id);
    if (!b) throw new Error('Тайтл не знайдено на FanVers');
    return toRemote(b);
  },

  async getChapters(titleId) {
    const res = await getJson<{ chapters: FChapter[] }>(`${API}/${encodeURIComponent(titleId)}/chapters/`);
    const list = res.chapters.filter((c) => !c.is_paid || c.is_purchased);
    // Номер — із назви («Розділ_80_Лінія…»); `order` на сайті починається заново в кожному томі.
    const parsed = list.map((c) => c.title.match(numRe)?.[1]?.replace(',', '.'));
    const byTitle = parsed.every(Boolean);
    return list.map((c, i): Chapter => {
      const name = c.title
        .replace(/_/g, ' ')
        .replace(/^\s*(?:розділ|глава)\s*\d+(?:[.,]\d+)?\s*[.:—–-]?\s*/i, '')
        .trim();
      return {
        id: `${titleId}/${c.slug}`,
        volume: volumeNo(c.volume_title),
        number: byTitle ? parsed[i]! : String(c.order),
        name: name || undefined,
        date: c.created_at ? Date.parse(c.created_at) : undefined,
        url: `${SITE}/books/${titleId}/chapters/${c.slug}`,
      };
    });
  },

  async getContent(chapter) {
    const [book, slug] = chapter.id.split('/');
    const res = await getJson<{ content?: string }>(
      `${API}/${encodeURIComponent(book!)}/chapters/${encodeURIComponent(slug!)}/`,
    );
    if (!res.content) throw new Error('Не вдалося завантажити текст розділу з FanVers');
    return { type: 'text', html: res.content };
  },
};
