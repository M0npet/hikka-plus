import type { HikkaTitle } from '../core/hikka';
import type { ReadKind } from '../core/page';

/** Тип контенту на джерелі — впливає на режим читалки за замовчуванням. */
export type ContentFormat = 'novel' | 'manga' | 'webtoon';

export interface RemoteTitle {
  id: string;
  title: string;
  altTitles: string[];
  cover?: string;
  format: ContentFormat;
  chapterCount?: number;
  year?: number;
  url: string;
}

export interface Chapter {
  id: string;
  volume: string | null;
  number: string;
  /** Номер, як на сайті, якщо `number` — наскрізний (сайт нумерує розділи заново в кожному томі). */
  shown?: string;
  /** Назва розділу, якщо є. */
  name?: string;
  team?: string;
  date?: number; // unix ms
  url: string;
}

export type ChapterContent =
  | { type: 'text'; html: string }
  | { type: 'images'; pages: { id: string; url: (quality: ImageQualityHint) => string }[] };

export type ImageQualityHint = 'original' | 'high' | 'medium' | 'low';

/**
 * Джерело читання. Щоб додати сайт — реалізуй цей інтерфейс,
 * зареєструй у registry.ts і додай API-хост у core/hosts.ts.
 */
export interface ReadSource {
  id: string;
  name: string;
  kinds: ReadKind[];
  search(query: string, kind: ReadKind): Promise<RemoteTitle[]>;
  /** Спроба знайти тайтл автоматично (за посиланням із Hikka або за назвою). */
  autoMatch(title: HikkaTitle): Promise<RemoteTitle | null>;
  getTitle(id: string): Promise<RemoteTitle>;
  getChapters(titleId: string): Promise<Chapter[]>;
  /**
   * Лише найновіші розділи (один запит) — для плашок «▶ N нових розділів» (src/cards/released.ts), яким потрібен
   * тільки номер останнього. Є в джерел, що віддають розділи сторінками; інакше береться getChapters.
   */
  getLatest?(titleId: string): Promise<Chapter[]>;
  getContent(chapter: Chapter): Promise<ChapterContent>;
}

/** Номер розділу для показу: як на сайті. */
export const chapterNo = (c: Pick<Chapter, 'number' | 'shown'>) => c.shown ?? c.number;

/**
 * Деякі сайти (напр. Бака) нумерують розділи заново в кожному томі: «Том 8 · Розділ 15».
 * Прогрес, «далі» і запис у Hikka рахуються за номером, тож такі розділи отримують
 * наскрізний номер 1..N (у порядку том → розділ), а номер із сайту лишається в `shown`.
 */
export function renumberByVolume(list: Chapter[]): Chapter[] {
  const num = (s: string | null | undefined) => Number.parseFloat(String(s ?? '0').replace(',', '.')) || 0;
  const volOf = new Map<number, string | null>();
  let restarts = false;
  for (const c of list) {
    const n = num(c.number);
    if (volOf.has(n) && volOf.get(n) !== c.volume) {
      restarts = true;
      break;
    }
    volOf.set(n, c.volume);
  }
  if (!restarts) return list;
  const sorted = [...list].sort((a, b) => num(a.volume) - num(b.volume) || num(a.number) - num(b.number));
  const seq = new Map<string, number>();
  return sorted.map((c) => {
    const k = `${num(c.volume)}:${num(c.number)}`;
    if (!seq.has(k)) seq.set(k, seq.size + 1);
    return { ...c, number: String(seq.get(k)), shown: c.number };
  });
}

export function chapterLabel(c: Pick<Chapter, 'volume' | 'number' | 'shown' | 'name'>): string {
  const base = `${c.volume ? `Том ${c.volume} · ` : ''}Розділ ${chapterNo(c)}`;
  return c.name ? `${base}: ${c.name}` : base;
}
