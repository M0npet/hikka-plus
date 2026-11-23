/*
 * Збережене для плеєра: стан серій тайтлу, останній вибір (команда/плеєр/серія/час) і налаштування.
 * Ключі: local:hp:watch:<slug> (до 300 тайтлів не чистимо — записи маленькі), local:hp:watchPrefs.
 */
import { storage } from '#imports';
import { useEffect, useState } from 'react';

export type SavedEpisode = { pos: number; w?: 1; at: number };

export type WatchSaved = {
  eps: Record<string, SavedEpisode>;
  team?: string;
  player?: string;
  ep?: number;
  /** Остання позиція поточної серії, сек (щоб повернутися після «Ширше»/F5). */
  t?: number;
  u: number;
};

export type WatchPrefs = {
  /** Показувати блок «Перегляд» на сторінці аніме. */
  enabled: boolean;
  autoNext: boolean;
  hikkaSync: boolean;
  favPlayer?: string;
  /** Режим «Ширше» — запам'ятовується між тайтлами. */
  wide?: boolean;
  /** Підсвітка навколо плеєра кольорами з відео (як Ambient mode на YouTube). undefined — увімкнено. */
  ambient?: boolean;
  /** Непрозорість підсвітки, 10–100 % (у налаштуваннях — «Прозорість» = 100 − це). undefined — 20, тобто прозорість 80 % (MK 16:12). */
  ambientLevel?: number;
  /** Яскравість кольорів підсвітки, 50–200 %. undefined — 100 (MK 16:07). */
  ambientBright?: number;
  /** Тривалість анімації «Ширше», мс (0 — без анімації). undefined — DEFAULT_WIDE_ANIM. Показуємо завжди, навіть за «менше руху» в системі (MK 16:45). */
  wideAnim?: number;
  /** Підсвітка пристроїв від відео (src/lights/: Philips TV, WLED, Hue, Razer) — експериментально, за замовчуванням вимк. */
  devices?: boolean;
  /** Мітки OP/ED: смужка під плеєром, кнопка «Пропустити», пошук за кадрами (src/watch/skip-marks.ts). undefined — увімкнено. */
  marks?: boolean;
  /** Пропускати опенінг / ендинг самому (за замовчуванням — ні, лише кнопка). */
  skipOp?: boolean;
  skipEd?: boolean;
  /**
   * Сканер міток (0.5.22): прихований другий плеєр проганяє на 16× початок (6 хв) і кінець (5 хв) цієї й сусідньої серії,
   * щоб мітки були без очікування двох серій. undefined — увімкнено (MK 21:14: «если экономия трафика — не запускать,
   * и отключение в настройках»): не запускається, якщо браузер каже про економію трафіку / повільну чи мобільну мережу
   * (scanAllowedByNetwork; Network Information API є лише в Chromium — у Firefox лише цей вимикач).
   */
  scan?: boolean;
};

export const DEFAULT_AMBIENT_LEVEL = 20;
export const DEFAULT_AMBIENT_BRIGHT = 100;
export const DEFAULT_WIDE_ANIM = 320;
export const SCAN_HINT =
  'Мітки одразу, без двох переглянутих серій: прихований плеєр проганяє початок і кінець серій на 16× (~100 МБ на тайтл). Не запускається в режимі економії трафіку, у повільній і мобільній мережі (Chrome, Edge; у Firefox — лише цим вимикачем)';

/** Мережа дозволяє сканер: немає «економії трафіку», не 2G/3G і не мобільна (якщо браузер це повідомляє). */
export function scanAllowedByNetwork(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; type?: string } }).connection;
  if (!c) return true; // Firefox, Safari — API немає
  if (c.saveData) return false;
  if (c.effectiveType && /(^|-)(2g|3g)$/.test(c.effectiveType)) return false;
  return c.type !== 'cellular';
}

export const DEFAULT_WATCH_PREFS: WatchPrefs = { enabled: true, autoNext: true, hikkaSync: true };

export const watchPrefsItem = storage.defineItem<WatchPrefs>('local:hp:watchPrefs', { fallback: DEFAULT_WATCH_PREFS });

const key = (slug: string) => `local:hp:watch:${slug}` as const;

export async function getWatchSaved(slug: string): Promise<WatchSaved> {
  return ((await storage.getItem<WatchSaved>(key(slug))) ?? { eps: {}, u: 0 }) as WatchSaved;
}

// Записи йдуть часто (позиція раз на кілька секунд) — по черзі, щоб не загубити зміну.
const queues = new Map<string, Promise<void>>();
export function updateWatchSaved(slug: string, fn: (s: WatchSaved) => WatchSaved): Promise<void> {
  const prev = queues.get(slug) ?? Promise.resolve();
  const next = prev.then(async () => {
    const cur = await getWatchSaved(slug);
    await storage.setItem(key(slug), { ...fn(cur), u: Date.now() });
  });
  queues.set(slug, next.catch(() => {}));
  return next;
}

export function useWatchPrefs(): [WatchPrefs, (p: Partial<WatchPrefs>) => void] {
  const [v, setV] = useState<WatchPrefs>(DEFAULT_WATCH_PREFS);
  useEffect(() => {
    void watchPrefsItem.getValue().then((x) => setV({ ...DEFAULT_WATCH_PREFS, ...x }));
    return watchPrefsItem.watch((x) => setV({ ...DEFAULT_WATCH_PREFS, ...x }));
  }, []);
  const set = (p: Partial<WatchPrefs>) => {
    const nv = { ...v, ...p };
    setV(nv);
    void watchPrefsItem.setValue(nv);
  };
  return [v, set];
}
