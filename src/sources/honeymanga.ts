import { getJson } from '../core/net';
import { autoMatchBy, chapterNum } from './match';
import type { Chapter, ContentFormat, ReadSource, RemoteTitle } from './types';

// Honey Manga: відкрите JSON API (data.api / search.api), картинки на b-cdn.
// Манґа/манхва — кадри (/v3/chapters/<id>/frames); новели — текст у форматі BlockNote (/novel/<тайтл>/chapter/<id>/data).
const SITE = 'https://honey-manga.com.ua';
const API = 'https://data.api.honey-manga.com.ua';
const SEARCH = 'https://search.api.honey-manga.com.ua/v2/manga/pattern';
const CDN = 'https://hmvolumestorage.b-cdn.net';
const IMG = `${CDN}/public-resources`;

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

const isNovelType = (type = '') => /новел|ранобе|роман/i.test(type);
const formatOf = (type = ''): ContentFormat =>
  isNovelType(type) ? 'novel' : /манхва|маньхва|вебтун|webtoon/i.test(type) ? 'webtoon' : 'manga';

/** Тайтли-новели (id), щоб у getContent знати, звідки брати текст. */
const novelIds = new Set<string>();

// ---------- BlockNote → HTML (далі текст іде через DOMPurify у читалці) ----------

interface BInline {
  type: string;
  text?: string;
  href?: string;
  styles?: Record<string, unknown>;
  content?: BInline[];
}
interface BBlock {
  type: string;
  props?: Record<string, unknown>;
  content?: BInline[] | string;
  children?: BBlock[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(list: BInline[] | string | undefined): string {
  if (typeof list === 'string') return esc(list);
  return (list ?? [])
    .map((n) => {
      if (n.type === 'link') return `<a href="${esc(n.href ?? '')}" target="_blank" rel="noreferrer">${inline(n.content)}</a>`;
      let s = esc(n.text ?? '').replace(/\n/g, '<br>');
      const st = n.styles ?? {};
      if (st.bold) s = `<b>${s}</b>`;
      if (st.italic) s = `<i>${s}</i>`;
      if (st.underline) s = `<u>${s}</u>`;
      if (st.strike) s = `<s>${s}</s>`;
      if (st.code) s = `<code>${s}</code>`;
      return s;
    })
    .join('');
}

function blocks(list: BBlock[] = []): string {
  let prevEmpty = true; // порожні абзаци на початку і підряд — схлопуємо
  return list
    .map((b) => {
      const empty = b.type === 'paragraph' && !inline(b.content) && !b.children?.length;
      if (empty) {
        if (prevEmpty) return '';
        prevEmpty = true;
        return '<p><br></p>';
      }
      prevEmpty = false;
      const inner = inline(b.content);
      const kids = b.children?.length ? blocks(b.children) : '';
      switch (b.type) {
        case 'heading': {
          const l = Math.min(4, Math.max(2, Number(b.props?.level ?? 2) + 1));
          return `<h${l}>${inner}</h${l}>${kids}`;
        }
        case 'image': {
          const src = String(b.props?.src ?? b.props?.url ?? '');
          if (!src) return kids;
          const url = /^https?:/.test(src) ? src : `${CDN}/${src.replace(/^\//, '')}`;
          return `<p><img src="${esc(url)}" alt=""></p>${kids}`;
        }
        case 'bulletListItem':
          return `<ul><li>${inner}${kids}</li></ul>`;
        case 'numberedListItem':
          return `<ol><li>${inner}${kids}</li></ol>`;
        case 'quote':
          return `<blockquote>${inner}</blockquote>${kids}`;
        default:
          return `<p>${inner}</p>${kids}`;
      }
    })
    .join('');
}

export function blockNoteToHtml(raw: unknown): string {
  return Array.isArray(raw) ? blocks(raw as BBlock[]) : '';
}

function toRemote(t: HTitle): RemoteTitle {
  if (isNovelType(t.type)) novelIds.add(t.id);
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
  kinds: ['manga', 'novel'],

  async search(query, kind) {
    // Сайт шукає щонайменше від 3 символів.
    const q = query.trim();
    if (q.length < 3) return [];
    const list = await getJson<HTitle[]>(`${SEARCH}?query=${encodeURIComponent(q)}`);
    // Новели — лише для сторінок ранобе на Hikka, комікси — для манґи.
    return list.map(toRemote).filter((t) => (kind === 'novel') === (t.format === 'novel'));
  },

  autoMatch(title) {
    return autoMatchBy(this, title, /honey-manga\.com\.ua\/book\/([0-9a-f-]{36})/i);
  },

  async getTitle(id) {
    return toRemote(await getJson<HTitle>(`${API}/manga/${encodeURIComponent(id)}`));
  },

  async getChapters(titleId) {
    if (!novelIds.has(titleId)) await this.getTitle(titleId).catch(() => null); // дізнатися тип тайтлу
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
    // url розділу: /read/<id розділу>/<id тайтлу>
    const titleId = chapter.url.split('/').pop() ?? '';
    if (novelIds.has(titleId)) {
      const data = await getJson<unknown>(
        `${API}/novel/${encodeURIComponent(titleId)}/chapter/${encodeURIComponent(chapter.id)}/data`,
      );
      const html = blockNoteToHtml(data);
      if (!html.trim()) throw new Error('Розділ порожній або платний');
      return { type: 'text', html };
    }
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
