/*
 * Нові розділи в нашій читалці (бэклог h, MK 2026-11-26) — як «Нові серії в озвучках» (src/watch/dub-alerts.ts).
 *
 * Що стежимо: тайтли манґи/ранобе, які користувач читав у нашій читалці (є прогрес), — до MAX_TRACK; джерело й команда —
 * ті, що обрані в блоці «Розділи». Content script при відкритті тайтлу записує `local:hp:chaps[<kind>:<slug>]`
 * (джерело, id на ньому, команда, найбільший номер розділу); `seen` = те саме число. Фон раз на CHECK_EVERY_MIN питає
 * джерело (src/features/chapter-check.ts) і, якщо розділів більше, оновлює `n` → число на іконці (разом з озвучками) і,
 * за бажанням, сповіщення браузера.
 * Лише джерела, де найновіші розділи — один запит: з getLatest (UAManga, Honey Manga, Бака) і ONE_REQUEST (весь список —
 * один JSON). Решта (manga.in.ua тощо) — кілька запитів на тайтл, у фоні їх не смикаємо.
 * Модуль без імпорту джерел — його тягне вікно налаштувань.
 */
import { storage } from '#imports';
import type { ReadKind } from '../core/page';

type ChapTrack = {
  /** Назва тайтлу (з Hikka). */
  name: string;
  kind: ReadKind;
  /** Джерело (id), його назва для показу, id тайтлу на ньому, команда ('' — усі). */
  s: string;
  sn: string;
  id: string;
  t: string;
  /** Найбільший номер розділу — за останньою перевіркою. */
  n: number;
  /** Скільки було, коли користувач востаннє відкривав тайтл. */
  seen: number;
  /** Коли користувач востаннє відкривав тайтл. */
  at: number;
  /** Коли востаннє з'явився новий розділ (або коли почали стежити). */
  nu: number;
};

/** `<kind>:<slug>` → що стежимо. */
export type ChapMap = Record<string, ChapTrack>;

export type ChapPrefs = { on: boolean; badge: boolean; notify: boolean };

export const DEFAULT_CHAP_PREFS: ChapPrefs = { on: true, badge: true, notify: false };
export const MAX_CHAP_TRACK = 40;
export const CHAP_CHECK_MIN = 180;
/** Джерела без getLatest, у яких увесь список розділів — один JSON-запит. */
export const ONE_REQUEST = new Set(['zenko', 'dgmanga']);
/** Тайтл без нових розділів і без заходів так довго — перестаємо стежити. */
const STALE_MS = 90 * 86_400_000;

export const chapsItem = storage.defineItem<ChapMap>('local:hp:chaps', { fallback: {} });
export const chapPrefsItem = storage.defineItem<ChapPrefs>('local:hp:chapPrefs', { fallback: DEFAULT_CHAP_PREFS });
export const chapCheckItem = storage.defineItem<number>('local:hp:chapCheck', { fallback: 0 });

export const getChapPrefs = async (): Promise<ChapPrefs> => ({ ...DEFAULT_CHAP_PREFS, ...(await chapPrefsItem.getValue()) });

export const chapNew = (t: ChapTrack) => Math.max(0, t.n - t.seen);
export const chapNewTotal = (m: ChapMap) => Object.values(m).reduce((s, t) => s + chapNew(t), 0);
export const chapUrl = (key: string) => {
  const i = key.indexOf(':');
  return `https://hikka.io/${key.slice(0, i)}/${encodeURIComponent(key.slice(i + 1))}`;
};

let queue: Promise<unknown> = Promise.resolve();
export function updateChaps(fn: (m: ChapMap) => ChapMap): Promise<void> {
  const next = queue.then(async () => chapsItem.setValue(fn({ ...(await chapsItem.getValue()) })));
  queue = next.catch(() => {});
  return next;
}

export function pruneChaps(m: ChapMap, now = Date.now()): ChapMap {
  const live = Object.entries(m).filter(([, t]) => now - Math.max(t.at, t.nu) < STALE_MS);
  live.sort(([, a], [, b]) => Math.max(b.at, b.nu) - Math.max(a.at, a.nu));
  return Object.fromEntries(live.slice(0, MAX_CHAP_TRACK));
}

/** Content script: тайтл відкрито, розділи активного джерела завантажено, користувач уже читав у нашій читалці. */
export async function noteChapSeen(kind: ReadKind, slug: string, t: Omit<ChapTrack, 'kind' | 'seen' | 'at' | 'nu'>) {
  if (!t.n || !(await getChapPrefs()).on) return;
  const key = `${kind}:${slug}`;
  const now = Date.now();
  await updateChaps((m) => {
    const cur = m[key];
    const same = cur && cur.s === t.s && cur.id === t.id && cur.t === t.t;
    // Те саме й щойно записане — не смикаємо сховище (стан тайтлу оновлюється часто).
    if (same && cur.n === t.n && cur.seen === t.n && now - cur.at < 60_000) return m;
    m[key] = { ...t, kind, seen: t.n, at: now, nu: same && cur.n === t.n ? cur.nu : now };
    return pruneChaps(m, now);
  });
}

export const forgetChap = (key: string) =>
  updateChaps((m) => {
    delete m[key];
    return m;
  });

export type ChapCheckRequest = { type: 'hp-chaps'; op: 'check' };
export type ChapCheckResult = { ok: boolean; found: number; error?: string };
