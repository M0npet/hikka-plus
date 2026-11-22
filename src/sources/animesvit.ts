import { getJson } from '../core/net';
import type { ReadKind } from '../core/page';
import { autoMatchBy, chapterNum } from './match';
import type { Chapter, ContentFormat, ReadSource, RemoteTitle } from './types';

// Animesvit: відкрите JSON API back.animesvit.com (манґа, манхва, маньхва, ранобе).
const SITE = 'https://animesvit.com';
const API = 'https://back.animesvit.com/api';

interface ATitle {
  id: number;
  slug: string;
  title_uk: string;
  title_en?: string | null;
  title_original?: string | null;
  cover_url?: string | null;
  content_type?: string | null;
  release_year?: number | null;
  total_chapters?: number | null;
}
interface AChapter {
  id: number;
  number: number | string;
  title?: string | null;
  status?: string;
  published_at?: string | null;
  studio?: { name?: string } | null;
}

const NOVEL = /ranobe|novel/;
const formatOf = (t?: string | null): ContentFormat =>
  NOVEL.test(t ?? '') ? 'novel' : /manhwa|manhua|webtoon/.test(t ?? '') ? 'webtoon' : 'manga';
const pathOf = (t?: string | null) => (NOVEL.test(t ?? '') ? 'ranobe' : 'manga');

const toRemote = (t: ATitle): RemoteTitle => ({
  id: t.slug,
  title: t.title_uk.trim(),
  altTitles: [t.title_en, t.title_original].filter((x): x is string => !!x?.trim()),
  cover: t.cover_url ?? undefined,
  format: formatOf(t.content_type),
  chapterCount: t.total_chapters ?? undefined,
  year: t.release_year ?? undefined,
  url: `${SITE}/${pathOf(t.content_type)}/${t.slug}`,
});

const kindOk = (t: RemoteTitle, kind: ReadKind) => (kind === 'novel') === (t.format === 'novel');

export const animesvit: ReadSource = {
  id: 'animesvit',
  name: 'Animesvit',
  kinds: ['manga', 'novel'],

  async search(query, kind) {
    const q = query.trim();
    if (!q) return [];
    const res = await getJson<{ data: ATitle[] }>(`${API}/manga?lang=uk&safe=0&q=${encodeURIComponent(q)}`);
    return (res.data ?? []).map(toRemote).filter((t) => kindOk(t, kind));
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /animesvit\.com\/(?:manga|manhwa|manhua|ranobe|novel)\/([\w-]+)/);
  },

  async getTitle(id) {
    const res = await getJson<{ manga: ATitle }>(`${API}/manga/${encodeURIComponent(id)}?lang=uk`);
    return toRemote(res.manga);
  },

  async getChapters(titleId) {
    const { manga } = await getJson<{ manga: ATitle }>(`${API}/manga/${encodeURIComponent(titleId)}?lang=uk`);
    const res = await getJson<{ chapters: AChapter[] }>(`${API}/manga/${manga.id}/chapters?lang=uk`);
    const base = `${SITE}/${pathOf(manga.content_type)}/${manga.slug}/read/${manga.id}`;
    return (res.chapters ?? [])
      .filter((c) => !c.status || c.status === 'published')
      .map<Chapter>((c) => ({
        id: `${manga.id}:${c.id}`,
        volume: null,
        number: String(c.number),
        name: c.title?.trim() || undefined,
        team: c.studio?.name ?? undefined,
        date: c.published_at ? Date.parse(c.published_at) : undefined,
        url: `${base}/${c.id}`,
      }))
      .sort((a, b) => chapterNum(a.number) - chapterNum(b.number));
  },

  async getContent(chapter) {
    const [mangaId, chapterId] = chapter.id.split(':');
    const res = await getJson<{
      chapter: { content_html?: string | null };
      pages?: { id: number; sort_order: number; webp_url?: string | null; original_url: string }[];
    }>(`${API}/manga/${mangaId}/chapters/${chapterId}/pages?lang=uk`);
    const pages = [...(res.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    if (pages.length) {
      return {
        type: 'images',
        pages: pages.map((p) => ({
          id: String(p.id),
          url: (q) => (q !== 'original' && p.webp_url) || p.original_url,
        })),
      };
    }
    if (res.chapter.content_html) return { type: 'text', html: res.chapter.content_html };
    throw new Error('Розділ порожній або недоступний');
  },
};
