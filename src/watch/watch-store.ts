/*
 * Збережене для плеєра: стан серій тайтлу, останній вибір (команда/плеєр/серія/час) і налаштування.
 * Ключі: local:hp:watch:<slug> (до 300 тайтлів не чистимо — записи маленькі), local:hp:watchPrefs.
 */
import { storage } from '#imports';
import { useEffect, useState } from 'react';
import { decodeRead, encodeRead } from '../core/progress-sync';
import { syncOn } from '../core/sync-flag';

type SavedEpisode = { pos: number; w?: 1; at: number };

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
  /** Кнопка «Наступна серія» на ендингу — з відліком NEXT_COUNTDOWN с і переходом самому (за замовчуванням — ні, лише кнопка). */
  nextCountdown?: boolean;
  /** «Далі з Дивлюсь» на останній серії без наступного сезону (src/watch/up-next.ts). undefined — увімкнено (MK 2026-11-26 17:44: «сделай отключаемым»). */
  upNext?: boolean;
  /** Типи серій (канон аніме / змішаний / філер) у сітці серій — з Mikai (src/watch/fillers.ts). undefined — увімкнено. */
  fillers?: boolean;
  /** Непрозорість фону меню над плеєром (⚙, серії, озвучка, плеєр), 10–100 % (у налаштуваннях — «Прозорість» = 100 − це). undefined — DEFAULT_MENU_LEVEL (MK 16:59). */
  menuLevel?: number;
};

/** Скільки секунд перегляду ендингу до самостійного переходу на наступну серію (WatchPrefs.nextCountdown). */
export const NEXT_COUNTDOWN = 5;

export type WatchSize = 'grid' | 'window' | 'screen';

export const DEFAULT_AMBIENT_LEVEL = 20;
export const DEFAULT_AMBIENT_BRIGHT = 100;
export const DEFAULT_MENU_LEVEL = 70;
export const DEFAULT_WIDE_ANIM = 320;
const DEFAULT_WATCH_PREFS: WatchPrefs = { enabled: true, autoNext: true, hikkaSync: true };

const watchPrefsItem = storage.defineItem<WatchPrefs>('local:hp:watchPrefs', { fallback: DEFAULT_WATCH_PREFS });

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
    const nx = fn(cur);
    // Нічого не змінилось (напр. блок при відкритті тайтлу повідомив ту саму команду/плеєр/серію) — не пишемо:
    // інакше новий u щоразу штовхав би запис у storage.sync і будив слухачів в усіх вкладках (аудит 2026-11-26).
    if (JSON.stringify({ ...nx, u: 0 }) === JSON.stringify({ ...cur, u: 0 })) return;
    await storage.setItem(key(slug), { ...nx, u: Date.now() });
    scheduleWatchPush(slug);
  });
  queues.set(slug, next.catch(() => {}));
  return next;
}

// ---------- Між пристроями (MK 2026-11-26): storage.sync, як прогрес читалки (src/core/progress-sync.ts) ----------
// Запис: { w: "1-5,7" — переглянуті серії, e/t — серія й секунда, tm/pl — команда й плеєр, u — час }. Новіший перемагає.
// Ключів у sync ≤ 512: прогрес читалки 400 + прив'язки 80 + кілька налаштувань — тож аніме лише WATCH_SYNC_MAX останніх.

type WatchSyncRecord = { w: string; e?: number; t?: number; tm?: string; pl?: string; u: number };

const WATCH_SYNC_PREFIX = 'hp:w:';
const WATCH_SYNC_MAX = 25;
const WATCH_PUSH_MS = 30_000; // позиція міняється щосекунди — у sync не частіше (Chrome: 120 записів/хв на всі ключі)
const syncKey = (slug: string) => `sync:${WATCH_SYNC_PREFIX}${slug}` as const;

function toSyncRecord(s: WatchSaved): WatchSyncRecord {
  const w = encodeRead(Object.entries(s.eps).filter(([, e]) => e.w).map(([k]) => k));
  const rec: WatchSyncRecord = { w, u: s.u };
  if (s.ep) rec.e = s.ep;
  if (s.t) rec.t = Math.round(s.t);
  if (s.team) rec.tm = s.team;
  if (s.player) rec.pl = s.player;
  return rec;
}

/** Накласти новіший запис з іншого пристрою на локальний: відмітки «переглянуто», серія, секунда, команда/плеєр. */
function applySyncRecord(local: WatchSaved, rec: WatchSyncRecord): WatchSaved {
  const watched = new Set(decodeRead(rec.w));
  const eps: WatchSaved['eps'] = {};
  for (const [k, e] of Object.entries(local.eps)) if (!e.w) eps[k] = e; // недодивлені — лишаємо свої позиції
  for (const k of watched) eps[k] = { pos: 1, w: 1, at: local.eps[k]?.at ?? rec.u };
  return { ...local, eps, ep: rec.e ?? local.ep, t: rec.t ?? 0, team: rec.tm ?? local.team, player: rec.pl ?? local.player, u: rec.u };
}

/** Підтягнути позицію з інших пристроїв (якщо там новіше). true — локальне змінилося. */
export async function pullWatchSaved(slug: string): Promise<boolean> {
  try {
    if (!(await syncOn())) return false;
    const rec = await storage.getItem<WatchSyncRecord>(syncKey(slug));
    const local = await getWatchSaved(slug);
    if (rec && rec.u > local.u) {
      await storage.setItem(key(slug), applySyncRecord(local, rec)); // u — як у записі, назад не шлемо
      return true;
    }
    if (!rec && local.u > 0) scheduleWatchPush(slug);
  } catch (e) {
    console.warn('[Hikka Plus] sync watch pull', e);
  }
  return false;
}

/** Поки відкрита сторінка тайтлу: зміна з іншого пристрою → onChange (перечитати збережене). */
export function watchSyncedWatch(slug: string, onChange: () => void) {
  return storage.watch<WatchSyncRecord>(syncKey(slug), async (rec) => {
    if (!rec || !(await syncOn())) return;
    const local = await getWatchSaved(slug);
    if (rec.u <= local.u) return;
    await storage.setItem(key(slug), applySyncRecord(local, rec));
    onChange();
  });
}

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleWatchPush(slug: string) {
  if (pushTimers.has(slug)) return; // уже чекає — відправить найсвіжіше на момент спрацювання
  pushTimers.set(
    slug,
    setTimeout(() => {
      pushTimers.delete(slug);
      void pushWatch(slug);
    }, WATCH_PUSH_MS),
  );
}
/** Сторінку закривають — відправити, що є (без очікування таймера). */
export function flushWatchPush(slug: string) {
  if (!pushTimers.has(slug)) return;
  clearTimeout(pushTimers.get(slug));
  pushTimers.delete(slug);
  void pushWatch(slug);
}

async function pushWatch(slug: string) {
  try {
    if (!(await syncOn())) return;
    const rec = toSyncRecord(await getWatchSaved(slug));
    const prev = await storage.getItem<WatchSyncRecord>(syncKey(slug));
    if (prev && prev.u >= rec.u) return;
    if (!prev) {
      const all = (await storage.snapshot('sync')) as Record<string, unknown>;
      const mine = Object.entries(all)
        .filter(([k]) => k.startsWith(WATCH_SYNC_PREFIX))
        .map(([k, v]) => ({ k, u: (v as WatchSyncRecord | null)?.u ?? 0 }))
        .sort((a, b) => a.u - b.u);
      if (mine.length >= WATCH_SYNC_MAX) await storage.removeItems(mine.slice(0, mine.length - WATCH_SYNC_MAX + 1).map((x) => `sync:${x.k}` as const));
    }
    await storage.setItem(syncKey(slug), rec);
  } catch (e) {
    console.warn('[Hikka Plus] sync watch push', e);
  }
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
