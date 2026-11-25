import type { HikkaTitle } from '../core/hikka';
import { titleNames } from '../core/hikka';
import { getJson, rethrowRateLimit } from '../core/net';
import type { ReadKind } from '../core/page';
import { bestSimilarity, exactly, settleMatch } from './match';
import type {
  Chapter,
  ChapterContent,
  ContentFormat,
  ImageQualityHint,
  ReadSource,
  RemoteTitle,
} from './types';

const API = 'https://api.zenko.online';
const SITE = 'https://zenko.online';
const STORAGE = 'https://storage.zenko.online';

/** Zenko кодує «том / номер / назва» в одному полі name через цей роздільник. */
const NAME_SEP = '@#%&;№%#&**#!@';

interface ZTitle {
  id: number;
  name: string;
  engName?: string | null;
  originalName?: string | null;
  coverImg?: string | null;
  category?: string | null;
  releaseYear?: number | null;
  totalChapterCount?: number | null;
  chaptersCount?: number | null;
}

interface ZChapter {
  id: number;
  name: string;
  titleId: number;
  createdAt?: number;
  isPublished?: boolean;
  publisher?: { name?: string } | null;
}

interface ZChapterFull extends ZChapter {
  pages?: { id: number; content: string; order?: number }[];
}

export function imageUrl(uuid: string, q: ImageQualityHint, width?: number): string {
  if (q === 'original') return `${STORAGE}/${uuid}`;
  const presets = { high: [1600, 90], medium: [1200, 75], low: [800, 60] } as const;
  const [w, quality] = presets[q];
  return `${STORAGE}/${uuid}?optimizer=image&width=${width ?? w}&quality=${quality}&height=auto`;
}

function formatOf(category?: string | null): ContentFormat {
  switch ((category ?? '').toUpperCase()) {
    case 'RANOBE':
      return 'novel';
    case 'MANGA':
    case 'MANGA_UA':
    case 'MALIOPYS':
      return 'manga';
    default:
      return 'webtoon'; // MANHVA, MANHUA, COMICS…
  }
}

function toRemote(t: ZTitle): RemoteTitle {
  return {
    id: String(t.id),
    title: t.name.trim(),
    altTitles: [t.engName, t.originalName].filter((x): x is string => !!x?.trim()).map((x) => x.trim()),
    cover: t.coverImg ? imageUrl(t.coverImg, 'low', 180) : undefined,
    format: formatOf(t.category),
    chapterCount: t.totalChapterCount ?? t.chaptersCount ?? undefined,
    year: t.releaseYear ?? undefined,
    url: `${SITE}/titles/${t.id}`,
  };
}

export function parseChapterName(raw: string): Pick<Chapter, 'volume' | 'number' | 'name'> {
  const [vol, number, ...rest] = raw.split(NAME_SEP);
  if (number !== undefined) {
    const name = rest.join(' ').trim();
    return { volume: vol?.trim() || null, number: number.trim(), name: name || undefined };
  }
  return { volume: null, number: raw.trim() };
}

const num = (s: string | null) => (s == null ? 0 : Number.parseFloat(s.replace(',', '.')) || 0);

function kindMatches(t: RemoteTitle, kind: ReadKind) {
  return kind === 'novel' ? t.format === 'novel' : t.format !== 'novel';
}

export const zenko: ReadSource = {
  id: 'zenko',
  name: 'Zenko',
  kinds: ['manga', 'novel'],

  async search(query, kind) {
    const q = query.trim();
    if (!q) return [];
    const res = await getJson<{ data: ZTitle[] }>(`${API}/titles?name=${encodeURIComponent(q)}`);
    return res.data.map(toRemote).filter((t) => kindMatches(t, kind));
  },

  async autoMatch(title: HikkaTitle) {
    // 1. Пряме посилання на Zenko у блоці «Читати» на Hikka.
    for (const ext of title.external) {
      const m = ext.url.match(/zenko\.online\/titles\/(\d+)/);
      if (m?.[1]) return exactly(await this.getTitle(m[1]));
    }
    // 2. Пошук за назвами.
    const names = titleNames(title);
    let best: { t: RemoteTitle; score: number } | null = null;
    for (const q of names.slice(0, 3)) {
      let found: RemoteTitle[];
      try {
        found = await this.search(q, title.kind);
      } catch (e) {
        rethrowRateLimit(e);
        continue;
      }
      for (const t of found.slice(0, 10)) {
        let score = bestSimilarity([t.title, ...t.altTitles], names);
        if (title.year && t.year && Math.abs(title.year - t.year) > 1) score -= 0.15;
        if (!best || score > best.score) best = { t, score };
      }
      if (best && best.score >= 0.98) break;
    }
    return settleMatch(this, title, best);
  },

  async getTitle(id) {
    return toRemote(await getJson<ZTitle>(`${API}/titles/${id}`));
  },

  async getChapters(titleId) {
    const list = await getJson<ZChapter[]>(`${API}/titles/${titleId}/chapters`);
    return list
      .filter((c) => c.isPublished !== false)
      .map<Chapter>((c) => ({
        id: String(c.id),
        ...parseChapterName(c.name),
        team: c.publisher?.name ?? undefined,
        date: c.createdAt ? c.createdAt * 1000 : undefined,
        url: `${SITE}/titles/${titleId}/${c.id}`,
      }))
      .sort((a, b) => num(a.volume) - num(b.volume) || num(a.number) - num(b.number));
  },

  async getContent(chapter): Promise<ChapterContent> {
    const full = await getJson<ZChapterFull>(`${API}/chapters/${chapter.id}`);
    const pages = [...(full.pages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!pages.length) throw new Error('Розділ порожній або недоступний без входу на Zenko');
    // Ранобе: content — HTML. Манґа: content — id картинки у сховищі.
    const isImage = pages.every((p) => /^[0-9a-f-]{36}$/i.test(p.content.trim()));
    if (!isImage) return { type: 'text', html: pages.map((p) => p.content).join('\n') };
    return {
      type: 'images',
      pages: pages.map((p) => ({ id: String(p.id), url: (q) => imageUrl(p.content.trim(), q) })),
    };
  },
};
