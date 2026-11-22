import { getJson } from '../core/net';
import type { ReadKind } from '../core/page';
import { autoMatchBy, chapterNum } from './match';
import type { Chapter, ContentFormat, ReadSource, RemoteTitle } from './types';

// DGManga: відкрите JSON API (/api), манґа, манхва, маньхва та романи.
const SITE = 'https://dgmanga.app';
const API = 'https://dgmanga.app/api';

interface DTitle {
  _id: string;
  title: string;
  originalTitle?: string | null;
  englishTitle?: string | null;
  alternativeTitles?: string[] | null;
  cover?: string | null;
  type?: string | null;
  year?: number | null;
  totalChapters?: number | null;
}
interface DChapter {
  _id: string;
  chapterNumber: number;
  volumeNumber?: number | null;
  chapterName?: string | null;
  createdAt?: string | null;
  isPublished?: boolean;
  teams?: { name?: string }[] | null;
}

const formatOf = (t?: string | null): ContentFormat =>
  t === 'novel' ? 'novel' : t === 'manga' ? 'manga' : 'webtoon';

const toRemote = (t: DTitle): RemoteTitle => ({
  id: t._id,
  title: t.title.trim(),
  altTitles: [t.englishTitle, t.originalTitle, ...(t.alternativeTitles ?? [])].filter((x): x is string => !!x?.trim()),
  cover: t.cover ?? undefined,
  format: formatOf(t.type),
  chapterCount: t.totalChapters ?? undefined,
  year: t.year ?? undefined,
  url: `${SITE}/title/${t._id}`,
});

const kindOk = (t: RemoteTitle, kind: ReadKind) => (kind === 'novel') === (t.format === 'novel');

export const dgManga: ReadSource = {
  id: 'dgmanga',
  name: 'DGManga',
  kinds: ['manga', 'novel'],

  async search(query, kind) {
    const q = query.trim();
    if (q.length < 2) return [];
    const res = await getJson<{ titles: DTitle[] }>(`${API}/titles?page=1&limit=28&q=${encodeURIComponent(q)}`);
    return (res.titles ?? []).map(toRemote).filter((t) => kindOk(t, kind));
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /dgmanga\.app\/title\/([0-9a-f]{24})/);
  },

  async getTitle(id) {
    return toRemote(await getJson<DTitle>(`${API}/titles/${encodeURIComponent(id)}`));
  },

  async getChapters(titleId) {
    const list = await getJson<DChapter[]>(`${API}/chapters/title/${encodeURIComponent(titleId)}`);
    return list
      .filter((c) => c.isPublished !== false)
      .map<Chapter>((c) => {
        const number = String(c.chapterNumber);
        return {
          id: c._id,
          volume: c.volumeNumber ? String(c.volumeNumber) : null,
          number,
          name: c.chapterName?.trim() || undefined,
          team: c.teams?.map((t) => t.name).filter(Boolean).join(', ') || undefined,
          date: c.createdAt ? Date.parse(c.createdAt) : undefined,
          url: `${SITE}/read/${titleId}/${number}?chapterId=${c._id}`,
        };
      })
      .sort((a, b) => chapterNum(a.volume) - chapterNum(b.volume) || chapterNum(a.number) - chapterNum(b.number));
  },

  async getContent(chapter) {
    const c = await getJson<{ type?: string; pages?: string[]; content?: string | null }>(`${API}/chapters/${chapter.id}`);
    if (c.pages?.length) return { type: 'images', pages: c.pages.map((u, i) => ({ id: String(i), url: () => u })) };
    // Текст романів приходить із &nbsp; замість пробілів — тоді рядки не переносяться.
    if (c.content) return { type: 'text', html: c.content.replace(/&nbsp;/g, ' ') };
    throw new Error('Розділ порожній або недоступний без входу на DGManga');
  },
};
