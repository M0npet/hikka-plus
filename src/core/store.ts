import { storage } from '#imports';
import { useEffect, useState } from 'react';
import type { ReadKind } from './page';

// ---------- Налаштування читалки ----------

export type NovelTheme = 'site' | 'sepia' | 'light' | 'dark';
export type NovelFont = 'site' | 'serif' | 'sans' | 'mono';
export type MangaMode = 'vertical' | 'paged';
export type MangaFit = 'width' | 'height' | 'original';
export type ImageQuality = 'original' | 'high' | 'medium' | 'low';

export interface ReaderSettings {
  novel: {
    fontSize: number; // px
    lineHeight: number;
    width: number; // px
    font: NovelFont;
    theme: NovelTheme;
    justify: boolean;
    indent: boolean;
    paragraphGap: number; // em
  };
  manga: {
    /** Режим за замовчуванням: манґа — сторінки, манхва/маньхва — стрічка. */
    modeManga: MangaMode;
    modeWebtoon: MangaMode;
    rtl: boolean;
    fit: MangaFit;
    width: number; // px, для стрічки та «за шириною»
    gap: number; // px між сторінками стрічки
    brightness: number; // %
    quality: ImageQuality;
    clickArea: 'image' | 'screen';
    pageNumbers: boolean;
  };
  /** Ховати панелі при прокрутці вниз і показувати при прокрутці вгору. */
  autoHideBars: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  novel: {
    fontSize: 18,
    lineHeight: 1.7,
    width: 760,
    font: 'site',
    theme: 'site',
    justify: false,
    indent: false,
    paragraphGap: 0.9,
  },
  manga: {
    modeManga: 'paged',
    modeWebtoon: 'vertical',
    rtl: false,
    fit: 'width',
    width: 900,
    gap: 0,
    brightness: 100,
    quality: 'high',
    clickArea: 'image',
    pageNumbers: true,
  },
  autoHideBars: true,
};

const settingsItem = storage.defineItem<ReaderSettings>('local:hp:settings', {
  fallback: DEFAULT_SETTINGS,
});

function mergeSettings(s: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    novel: { ...DEFAULT_SETTINGS.novel, ...s?.novel },
    manga: { ...DEFAULT_SETTINGS.manga, ...s?.manga },
  };
}

export async function getSettings(): Promise<ReaderSettings> {
  return mergeSettings(await settingsItem.getValue());
}

export async function updateSettings(fn: (s: ReaderSettings) => ReaderSettings) {
  await settingsItem.setValue(fn(await getSettings()));
}

export function useSettings(): ReaderSettings {
  const [s, setS] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    getSettings().then((v) => alive && setS(v));
    const un = settingsItem.watch((v) => setS(mergeSettings(v)));
    return () => {
      alive = false;
      un();
    };
  }, []);
  return s;
}

// ---------- Прив'язка тайтлу Hikka до тайтлів на джерелах ----------

export interface SourceLink {
  remoteId: string;
  title: string;
  url?: string;
  /** true — користувач обрав вручну (автопідбір більше не чіпає). */
  manual: boolean;
}

export interface Binding {
  /** Обране джерело (null — ще не обирали, беремо перше знайдене). */
  active: string | null;
  /** Знайдені/прив'язані тайтли на кожному джерелі; null — шукали й не знайшли. */
  links: Record<string, SourceLink | null>;
  /** Обрана команда перекладу для кожного джерела ('' — усі). */
  teams: Record<string, string>;
  /** Коли джерело востаннє шукали й не знайшли (ms). */
  misses: Record<string, number>;
}

const bindKey = (kind: ReadKind, slug: string) => `local:hp:bind2:${kind}:${slug}` as const;
const EMPTY_BINDING: Binding = { active: null, links: {}, teams: {}, misses: {} };

export async function getBinding(kind: ReadKind, slug: string): Promise<Binding> {
  const b = await storage.getItem<Binding>(bindKey(kind, slug));
  return { ...EMPTY_BINDING, ...b, links: { ...b?.links }, teams: { ...b?.teams }, misses: { ...b?.misses } };
}

let bindQueue: Promise<unknown> = Promise.resolve();

/** Записи йдуть по черзі: кілька джерел шукаються паралельно й не мають перетирати одне одного. */
export function patchBinding(kind: ReadKind, slug: string, fn: (b: Binding) => Binding) {
  bindQueue = bindQueue
    .then(async () => storage.setItem(bindKey(kind, slug), fn(await getBinding(kind, slug))))
    .catch(() => {});
  return bindQueue;
}

// ---------- Прогрес читання ----------
// Прогрес прив'язаний до НОМЕРА розділу, а не до id на сайті, тож він
// зберігається при перемиканні джерела чи команди.

export interface ChapterProgress {
  /** Позиція в розділі 0..1 (частка прокрутки або сторінок). */
  pos: number;
  read: boolean;
  at: number;
}

export interface Progress {
  /** Останній відкритий розділ. */
  last: { key: string; label: string; sourceId: string; chapterId: string } | null;
  chapters: Record<string, ChapterProgress>;
  updatedAt: number;
}

/** Ключ розділу для прогресу: номер без зайвих нулів («012» → «12», «12,5» → «12.5»). */
export function chapterKey(number: string): string {
  const n = Number.parseFloat(number.replace(',', '.'));
  return Number.isFinite(n) ? String(n) : number.trim().toLowerCase();
}

const progressKey = (kind: ReadKind, slug: string) => `local:hp:progress2:${kind}:${slug}` as const;
const EMPTY_PROGRESS: Progress = { last: null, chapters: {}, updatedAt: 0 };

export async function getProgress(kind: ReadKind, slug: string): Promise<Progress> {
  const p = await storage.getItem<Progress>(progressKey(kind, slug));
  return { ...EMPTY_PROGRESS, ...p, chapters: { ...p?.chapters } };
}

// Записи йдуть по черзі, щоб швидкі оновлення позиції не перетирали одне одного.
let queue: Promise<unknown> = Promise.resolve();

export function updateProgress(kind: ReadKind, slug: string, fn: (p: Progress) => Progress) {
  queue = queue
    .then(async () => {
      const next = fn(await getProgress(kind, slug));
      await storage.setItem(progressKey(kind, slug), { ...next, updatedAt: Date.now() });
    })
    .catch(() => {});
  return queue;
}

export function watchProgress(kind: ReadKind, slug: string, cb: (p: Progress) => void) {
  return storage.watch<Progress>(progressKey(kind, slug), (v) =>
    cb({ ...EMPTY_PROGRESS, ...v, chapters: { ...v?.chapters } }),
  );
}
