import { getDoc, getJson } from '../core/net';
import { autoMatchBy } from './match';
import type { Chapter, ReadSource, RemoteTitle } from './types';

// NovelHub (novel.org.ua): книги/ранобе українською, відкритий JSON API (`/api/works`).
// Текст розділу — у публічній сторінці розділу (SSR). Роботи 18+ сайт віддає лише
// після входу (`/api/chapters/<id>` → 401 adult) — такі не показуємо, захист не обходимо.
const SITE = 'https://novel.org.ua';

interface NWork {
  id: number;
  title: string;
  type: string;
  cover_url?: string | null;
  age_rating?: string | null;
  published_at?: string | null;
  original_title?: string | null;
  alt_titles?: string[] | null;
  chapters?: NChapter[];
}
interface NChapter {
  id: number;
  title?: string | null;
  chapter_number: number;
  published_at?: string | null;
  isLocked?: boolean;
}

const isAdult = (w: NWork) => w.age_rating === '18+';

const toRemote = (w: NWork): RemoteTitle => ({
  id: String(w.id),
  title: w.title.trim(),
  altTitles: [w.original_title ?? '', ...(w.alt_titles ?? [])].map((s) => s.trim()).filter(Boolean),
  cover: w.cover_url ? new URL(w.cover_url, SITE).href : undefined,
  format: 'novel',
  chapterCount: w.chapters?.length,
  url: `${SITE}/work/${w.id}`,
});

async function loadWork(id: string): Promise<NWork> {
  const w = await getJson<NWork>(`${SITE}/api/works/${encodeURIComponent(id)}`);
  if (isAdult(w)) throw new Error('Роботи 18+ NovelHub показує лише після входу на сайті');
  return w;
}

export const novelHub: ReadSource = {
  id: 'novelhub',
  name: 'NovelHub',
  kinds: ['novel'],

  async search(query) {
    const q = query.trim();
    if (!q) return [];
    const res = await getJson<{ works: NWork[] }>(
      `${SITE}/api/works?page=1&limit=20&search=${encodeURIComponent(q)}`,
    );
    return res.works.filter((w) => w.type === 'book' && !isAdult(w)).map(toRemote);
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /novel\.org\.ua\/work\/(\d+)/);
  },

  async getTitle(id) {
    return toRemote(await loadWork(id));
  },

  async getChapters(titleId) {
    const w = await loadWork(titleId);
    return (w.chapters ?? [])
      .filter((c) => !c.isLocked)
      .map((c): Chapter => {
        // «Розділ 1 Королівський приклик» → «Королівський приклик»: номер і так показуємо.
        const name = c.title?.trim().replace(/^(?:розділ|глава)\s*\d+(?:[.,]\d+)?\s*[.:—–-]?\s*/i, '');
        return {
          id: `${titleId}/${c.chapter_number}`,
          volume: null,
          number: String(c.chapter_number),
          name: name || undefined,
          date: c.published_at ? Date.parse(c.published_at) : undefined,
          url: `${SITE}/work/${titleId}/chapter/${c.chapter_number}`,
        };
      });
  },

  async getContent(chapter) {
    const doc = await getDoc(chapter.url);
    const text = doc.querySelector('article.reading-content');
    if (!text) throw new Error('Не знайшов текст розділу на NovelHub');
    return { type: 'text', html: text.innerHTML };
  },
};
