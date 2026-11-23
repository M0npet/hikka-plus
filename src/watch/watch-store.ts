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
};

export const DEFAULT_AMBIENT_LEVEL = 20;
export const DEFAULT_AMBIENT_BRIGHT = 100;

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
