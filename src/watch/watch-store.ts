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
  /**
   * Розмір плеєра в режимі «Ширше» (як у Mikai, MK 2026-11-24): grid — на ширину сітки сторінки (як було),
   * window — плеєр на всю ширину вікна (16:9), screen — плеєр на все вікно (ширина × висота вікна, сторінка під ним гортається).
   */
  size?: WatchSize;
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
  /** Мітки OP/ED (з плеєра, інакше AniSkip): смужка під плеєром, кнопка «Пропустити». undefined — увімкнено. */
  marks?: boolean;
  /** Пропускати опенінг / ендинг самому (за замовчуванням — ні, лише кнопка). */
  skipOp?: boolean;
  skipEd?: boolean;
};

export type WatchSize = 'grid' | 'window' | 'screen';

export const DEFAULT_AMBIENT_LEVEL = 20;
export const DEFAULT_AMBIENT_BRIGHT = 100;
export const DEFAULT_WIDE_ANIM = 320;
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
