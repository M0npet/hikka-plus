import { getJson } from '../core/net';
import { autoMatchBy, chapterNum } from './match';
import type { Chapter, ContentFormat, ReadSource, RemoteTitle } from './types';

// Honey Manga: відкрите JSON API (data.api / search.api), картинки на b-cdn.
const SITE = 'https://honey-manga.com.ua';
const API = 'https://data.api.honey-manga.com.ua';
const SEARCH = 'https://search.api.honey-manga.com.ua/v2/manga/pattern';
const IMG = 'https://hmvolumestorage.b-cdn.net/public-resources';

interface HTitle {
  id: string;
  posterId?: string;
  title: string;
  alternativeTitle?: string | null;
  type?: string;
  chapters?: number;
}
interface HChapter {
  id: string;
  volume: number;
  chapterNum: number;
  subChapterNum: number;
  title?: string;
  lastUpdated?: string;
  isMonetized?: boolean;
}

const formatOf = (type = ''): ContentFormat => (/манхва|маньхва|вебтун|webtoon/i.test(type) ? 'webtoon' : 'manga');

function toRemote(t: HTitle): RemoteTitle {
  return {
    id: t.id,
    title: t.title.trim(),
    altTitles: (t.alternativeTitle ?? '').split('/').map((s) => s.trim()).filter(Boolean),
    cover: t.posterId ? `${IMG}/${t.posterId}` : undefined,
    format: formatOf(t.type),
    url: `${SITE}/book/${t.id}`,
  };
}

const BAD_TITLES = new Set(['', '-', '--', 'title']);

export const honeyManga: ReadSource = {
  id: 'honeymanga',
  name: 'Honey Manga',
  kinds: ['manga'],

  async search(query) {
    // Сайт шукає щонайменше від 3 символів.
    const q = query.trim();
    if (q.length < 3) return [];
    const list = await getJson<HTitle[]>(`${SEARCH}?query=${encodeURIComponent(q)}`);
    return list.map(toRemote);
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /honey-manga\.com\.ua\/book\/([0-9a-f-]{36})/i);
  },

  async getTitle(id) {
    return toRemote(await getJson<HTitle>(`${API}/manga/${encodeURIComponent(id)}`));
  },

  async getChapters(titleId) {
    const out: Chapter[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await getJson<{ data: HChapter[]; total: number }>(
        `${API}/v3/comics/${encodeURIComponent(titleId)}/chapters?sortOrder=ASC&page=${page}&pageSize=200`,
      );
      for (const c of res.data) {
        // Платні (ранній доступ) розділи без входу не відкриються — пропускаємо.
        if (c.isMonetized) continue;
        const name = c.title?.trim() ?? '';
        out.push({
          id: c.id,
          volume: c.volume ? String(c.volume) : null,
          number: c.subChapterNum ? `${c.chapterNum}.${c.subChapterNum}` : String(c.chapterNum),
          name: BAD_TITLES.has(name.toLowerCase()) || /розділ/i.test(name) ? undefined : name,
          date: c.lastUpdated ? Date.parse(c.lastUpdated) : undefined,
          url: `${SITE}/read/${c.id}/${titleId}`,
        });
      }
      if (!res.data.length || page * 200 >= res.total) break;
    }
    return out.sort((a, b) => chapterNum(a.volume) - chapterNum(b.volume) || chapterNum(a.number) - chapterNum(b.number));
  },

  async getContent(chapter) {
    const frames = await getJson<{ frameIndex: number; dataUrl: string }[]>(`${API}/v3/chapters/${chapter.id}/frames`);
    if (!frames.length) throw new Error('Розділ порожній або платний');
    return {
      type: 'images',
      pages: frames
        .sort((a, b) => a.frameIndex - b.frameIndex)
        .map((f) => ({ id: String(f.frameIndex), url: () => `${IMG}${f.dataUrl.replace(/^public-resources/, '')}` })),
    };
  },
};
