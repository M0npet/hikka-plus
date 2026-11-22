/**
 * Синхронізація ВИБОРУ користувача між пристроями (storage.sync, без сервера):
 * - прив'язки тайтлу: обране джерело, вручну прив'язані тайтли, команди перекладу;
 * - налаштування читалки.
 * Автопідбір не синхронізується — кожен пристрій знайде сам. Конфлікти — «перемагає новіший» (u).
 * Ліміти storage.sync (512 ключів, 8 КБ на ключ, 120 записів/хв у Chrome) — пишемо рідко й стисло.
 */
import { storage } from '#imports';
import type { ReadKind } from './page';

/** Стислий запис прив'язки: a — активне джерело, m — ручні прив'язки [id, назва, url], t — команди. */
export interface BindRecord {
  a?: string | null;
  m?: Record<string, [string, string, string?]>;
  t?: Record<string, string>;
  u: number;
}

const BIND_PREFIX = 'hp:b:';
const MAX_BINDINGS = 80; // разом із прогресом (400) — у межах 512 ключів
const DEBOUNCE_MS = 3_000;

export const bindSyncKey = (kind: ReadKind, slug: string) =>
  `sync:${BIND_PREFIX}${kind === 'manga' ? 'm' : 'n'}:${slug}` as const;

export async function pullBind(kind: ReadKind, slug: string): Promise<BindRecord | null> {
  try {
    return (await storage.getItem<BindRecord>(bindSyncKey(kind, slug))) ?? null;
  } catch (e) {
    console.warn('[Hikka Plus] sync bind pull', e);
    return null;
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function debounce(key: string, fn: () => Promise<void>) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void fn().catch((e) => console.warn('[Hikka Plus] sync push', key, e));
    }, DEBOUNCE_MS),
  );
}

export function pushBind(kind: ReadKind, slug: string, get: () => Promise<BindRecord | null>) {
  const key = bindSyncKey(kind, slug);
  debounce(key, async () => {
    const rec = await get();
    if (!rec) return;
    const prev = await storage.getItem<BindRecord>(key);
    if (prev && prev.u >= rec.u) return;
    // Скинутий вибір пишемо як порожній запис із часом (а не видаляємо ключ),
    // інакше інший пристрій вирішить, що запису немає, і поверне свій старий вибір.
    const empty = !rec.a && !rec.m && !rec.t;
    if (empty && !prev) return;
    if (!prev) await pruneBindings();
    await storage.setItem(key, rec);
  });
}

async function pruneBindings() {
  const all = (await storage.snapshot('sync')) as Record<string, unknown>;
  const mine = Object.entries(all)
    .filter(([k]) => k.startsWith(BIND_PREFIX))
    .map(([k, v]) => ({ k, u: (v as BindRecord | null)?.u ?? 0 }));
  if (mine.length < MAX_BINDINGS) return;
  mine.sort((a, b) => a.u - b.u);
  await storage.removeItems(mine.slice(0, mine.length - MAX_BINDINGS + 1).map((x) => `sync:${x.k}` as const));
}

// ---------- Налаштування читалки ----------

const SETTINGS_KEY = 'sync:hp:settings' as const;

export interface SettingsRecord<T> {
  s: T;
  u: number;
}

export async function pullSettings<T>(): Promise<SettingsRecord<T> | null> {
  try {
    return (await storage.getItem<SettingsRecord<T>>(SETTINGS_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function pushSettings<T>(rec: SettingsRecord<T>) {
  debounce(SETTINGS_KEY, async () => {
    const prev = await storage.getItem<SettingsRecord<T>>(SETTINGS_KEY);
    if (prev && prev.u >= rec.u) return;
    await storage.setItem(SETTINGS_KEY, rec);
  });
}
