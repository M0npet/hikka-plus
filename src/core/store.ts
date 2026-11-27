import { storage } from '#imports';
import { useEffect, useState } from 'react';
import type { ReadKind } from './page';
import { pullProgress, schedulePush, watchSynced } from './progress-sync';
import { pullBind, pullSettings, pushBind, pushSettings, type BindRecord } from './prefs-sync';

// ---------- Налаштування читалки ----------

type NovelTheme = 'site' | 'sepia' | 'light' | 'dark';
type NovelFont = 'site' | 'serif' | 'sans' | 'mono';
type MangaMode = 'vertical' | 'paged';
type MangaFit = 'width' | 'height' | 'original';
/** Зони кліку/тапу: L — як у Senkuro/Mihon (верх і ліво — назад, низ і право — далі), ліво/право, верх/низ, вимкнено. */
export type TapScheme = 'l' | 'lr' | 'tb' | 'off';
type ImageQuality = 'original' | 'high' | 'medium' | 'low';

export interface ReaderSettings {
  /** Показувати читалку: кнопку «Читати» і блок «Розділи» на сторінках манґи й ранобе. */
  enabled: boolean;
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
    width: number; // px, манґа: стрічка та «за шириною»
    /** Окрема ширина для манхви/маньхви (стрічка). */
    widthWebtoon: number;
    /** Безкінечна стрічка: наступний розділ підвантажується одразу під поточним. */
    endless: boolean;
    /** Роздільник «Кінець розділу → наступний» між розділами в безкінечній стрічці. */
    feedSep: boolean;
    /** Автопрокрутка, px/с. */
    autoSpeed: number;
    /** Схема зон кліку/тапу (стрічка й посторінково); середина — завжди панелі. */
    tapScheme: TapScheme;
    gap: number; // px між сторінками стрічки
    brightness: number; // %
    quality: ImageQuality;
    clickArea: 'image' | 'screen';
    pageNumbers: boolean;
    /** Підсвітка: кольори сторінки м'яко розходяться по фону (MK 22:18). */
    glow: boolean;
    /** Непрозорість підсвітки 0..100 (повзунок показує прозорість = 100 − це). */
    glowLevel: number;
    /** Яскравість кольорів підсвітки, %. */
    glowBright: number;
  };
  /** Ховати панелі при прокрутці вниз і показувати при прокрутці вгору. */
  autoHideBars: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  enabled: true,
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
    widthWebtoon: 800,
    endless: true,
    feedSep: true,
    autoSpeed: 80,
    tapScheme: 'l',
    gap: 0,
    brightness: 100,
    quality: 'high',
    clickArea: 'image',
    pageNumbers: true,
    glow: true,
    glowLevel: 60,
    glowBright: 100,
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
    manga: {
      ...DEFAULT_SETTINGS.manga,
      // До 0.4.8 ширина була спільна — манхва бере її, поки користувач не змінить окремо.
      ...(s?.manga?.width != null && s.manga.widthWebtoon == null ? { widthWebtoon: s.manga.width } : {}),
      ...s?.manga,
    },
  };
}

/** Коли налаштування востаннє змінювали на ЦЬОМУ пристрої (для «перемагає новіший»). */
const settingsTimeItem = storage.defineItem<number>('local:hp:settings-u', { fallback: 0 });
let settingsPulled: Promise<void> | null = null;

/** Раз на сторінку: підтягнути налаштування з інших пристроїв, якщо вони новіші. */
function pullSettingsOnce() {
  settingsPulled ??= (async () => {
    const rec = await pullSettings<ReaderSettings>();
    if (rec && rec.u > (await settingsTimeItem.getValue())) {
      await settingsItem.setValue(mergeSettings(rec.s));
      await settingsTimeItem.setValue(rec.u);
    }
  })().catch(() => {});
  return settingsPulled;
}

export async function getSettings(): Promise<ReaderSettings> {
  await pullSettingsOnce();
  return mergeSettings(await settingsItem.getValue());
}

export async function updateSettings(fn: (s: ReaderSettings) => ReaderSettings) {
  const next = fn(await getSettings());
  const u = Date.now();
  await settingsItem.setValue(next);
  await settingsTimeItem.setValue(u);
  pushSettings({ s: next, u });
}

/** Стежити за налаштуваннями (зміни у вікні налаштувань розширення). */
export const watchSettings = (cb: (s: ReaderSettings) => void) => settingsItem.watch((v) => cb(mergeSettings(v)));

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
  /** Автопідбір: true — точно той самий тайтл (RemoteTitle.exact), false — лише схожа назва; немає — прив'язка до 0.6.1. */
  exact?: boolean;
}

interface Binding {
  /** Обране джерело (null — ще не обирали, беремо перше знайдене). */
  active: string | null;
  /** Знайдені/прив'язані тайтли на кожному джерелі; null — шукали й не знайшли. */
  links: Record<string, SourceLink | null>;
  /** Обрана команда перекладу для кожного джерела ('' — усі). */
  teams: Record<string, string>;
  /** Коли джерело востаннє шукали й не знайшли (ms). */
  misses: Record<string, number>;
  /** Підказка «Схоже»: кандидат нижче порогу автопідбору (прив'язується лише по кліку). */
  near?: Record<string, SourceLink>;
  /** «Ні» на підказці «Схоже»: id тайтлу на джерелі, який більше не пропонувати. */
  nearNo?: Record<string, string>;
  /** Версія пошуку, з якою записано «не знайдено»: новіша версія автопідбору → шукаємо знову. */
  nearV?: number;
  /** (до 0.4.5) пропозицію «відмітити 1–N за даними Hikka» відхилено; тепер відмічаємо одразу. */
  hikkaDismissed?: number;
  /** Коли користувач востаннє сам змінював вибір (джерело/ручна прив'язка/команда) — для синхронізації. */
  u?: number;
}

const bindKey = (kind: ReadKind, slug: string) => `local:hp:bind2:${kind}:${slug}` as const;
const EMPTY_BINDING: Binding = { active: null, links: {}, teams: {}, misses: {} };

export async function getBinding(kind: ReadKind, slug: string): Promise<Binding> {
  const b = await storage.getItem<Binding>(bindKey(kind, slug));
  return { ...EMPTY_BINDING, ...b, links: { ...b?.links }, teams: { ...b?.teams }, misses: { ...b?.misses } };
}

let bindQueue: Promise<unknown> = Promise.resolve();

/** Те, що синхронізується між пристроями: лише вибір користувача, не автопідбір. */
function toBindRecord(b: Binding): BindRecord | null {
  const m: NonNullable<BindRecord['m']> = {};
  for (const [src, l] of Object.entries(b.links)) {
    if (l?.manual) m[src] = l.url ? [l.remoteId, l.title, l.url] : [l.remoteId, l.title];
  }
  const t = Object.fromEntries(Object.entries(b.teams).filter(([, v]) => v));
  if (!b.active && !Object.keys(m).length && !Object.keys(t).length) return null;
  const rec: BindRecord = { u: b.u ?? 0 };
  if (b.active) rec.a = b.active;
  if (Object.keys(m).length) rec.m = m;
  if (Object.keys(t).length) rec.t = t;
  return rec;
}

/** Що відправити в sync: вибір, а якщо його скинули — порожній запис із часом скидання. */
function toPushRecord(b: Binding): BindRecord | null {
  return toBindRecord(b) ?? (b.u ? { u: b.u } : null);
}

const choiceDigest = (b: Binding) => JSON.stringify({ ...toBindRecord(b), u: 0 });

/** Накласти новіший вибір з іншого пристрою на локальну прив'язку. */
function applyBindRecord(b: Binding, rec: BindRecord): Binding {
  const links: Binding['links'] = {};
  // Автопідбір лишаємо, ручні прив'язки — як на іншому пристрої.
  for (const [src, l] of Object.entries(b.links)) if (!l?.manual) links[src] = l;
  for (const [src, [remoteId, title, url]] of Object.entries(rec.m ?? {})) {
    links[src] = { remoteId, title, url, manual: true };
  }
  return { ...b, active: rec.a ?? null, links, teams: { ...rec.t }, u: rec.u };
}

/** Прив'язка з урахуванням вибору на інших пристроях (для відкриття тайтлу). */
export async function getBindingSynced(kind: ReadKind, slug: string): Promise<Binding> {
  const rec = await pullBind(kind, slug);
  if (rec && rec.u > ((await getBinding(kind, slug)).u ?? 0)) {
    await patchBinding(kind, slug, (b) => applyBindRecord(b, rec), { fromSync: true });
  } else if (!rec) {
    // Вибір зроблено до появи синхронізації — відправити його.
    const local = await getBinding(kind, slug);
    if (toBindRecord(local)) pushBind(kind, slug, async () => toBindRecord(await getBinding(kind, slug)));
  }
  return getBinding(kind, slug);
}

/** Правки, що чекають запису: ключ прив'язки → черга змін (+ чи з синхронізації). */
const bindPending = new Map<string, { fns: ((b: Binding) => Binding)[]; fromSync: boolean; done: Promise<unknown> }>();

/**
 * Записи йдуть по черзі: кілька джерел шукаються паралельно й не мають перетирати одне одного. Правки одного тайтлу,
 * що накопичились, поки йшов попередній запис, застосовуємо разом — одне читання й один запис (перший захід на манґу:
 * автопідбір по 5–6 джерелах давав 5–6 записів, 2026-11-27). Нічого не змінилось — не пишемо.
 */
export function patchBinding(
  kind: ReadKind,
  slug: string,
  fn: (b: Binding) => Binding,
  opts?: { fromSync?: boolean; /** Почекати перед записом (мс), щоб приклеїти правки інших джерел (автопідбір). */ delay?: number },
) {
  const key = bindKey(kind, slug);
  const fromSync = !!opts?.fromSync;
  const wait = bindPending.get(key);
  // Синхронізація й локальні правки не змішуються: у них різне правило для часу вибору (u).
  if (wait && wait.fromSync === fromSync) {
    wait.fns.push(fn);
    return wait.done;
  }
  const job = { fns: [fn], fromSync, done: Promise.resolve() as Promise<unknown> };
  bindPending.set(key, job);
  const delay = opts?.delay ?? 0;
  bindQueue = bindQueue
    .then(() => delay > 0 && new Promise((r) => setTimeout(r, delay)))
    .then(async () => {
      if (bindPending.get(key) === job) bindPending.delete(key);
      const prev = await getBinding(kind, slug);
      let next = job.fns.reduce((b, f) => f(b), prev);
      const changed = !fromSync && choiceDigest(prev) !== choiceDigest(next);
      if (changed) next = { ...next, u: Date.now() };
      if (JSON.stringify(next) === JSON.stringify(prev)) return;
      await storage.setItem(key, next);
      if (changed) pushBind(kind, slug, async () => toPushRecord(await getBinding(kind, slug)));
    })
    .catch(() => {});
  job.done = bindQueue;
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
  /** Манґа: поточна сторінка (з 0) і кількість сторінок у розділі. */
  page?: number;
  pages?: number;
}

/** Підпис позиції в розділі: «стор. 12/24 · 48%» для манґи, «48%» для тексту; short — без відсотків, якщо є сторінки. */
export function posText(c: { pos: number; page?: number; pages?: number }, short = false): string {
  const pct = `${Math.round(c.pos * 100)}%`;
  if (!c.pages || c.pages < 2 || c.page == null) return pct;
  const pg = `стор. ${Math.min(c.page, c.pages - 1) + 1}/${c.pages}`;
  return short ? pg : `${pg} · ${pct}`;
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
      schedulePush(kind, slug, syncIo(kind, slug));
    })
    .catch(() => {});
  return queue;
}

/** Доступ до локального прогресу для синхронізації між пристроями. */
function syncIo(kind: ReadKind, slug: string) {
  return {
    get: () => getProgress(kind, slug),
    setRaw: (p: Progress) => {
      queue = queue.then(() => storage.setItem(progressKey(kind, slug), p)).catch(() => {});
      return queue as Promise<void>;
    },
  };
}

/** Підтягнути прогрес з інших пристроїв і стежити за ним (повертає функцію відписки). */
export async function syncProgress(kind: ReadKind, slug: string): Promise<() => void> {
  const io = syncIo(kind, slug);
  await pullProgress(kind, slug, io);
  return watchSynced(kind, slug, io);
}

export function watchProgress(kind: ReadKind, slug: string, cb: (p: Progress) => void) {
  return storage.watch<Progress>(progressKey(kind, slug), (v) =>
    cb({ ...EMPTY_PROGRESS, ...v, chapters: { ...v?.chapters } }),
  );
}
