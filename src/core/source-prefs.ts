/**
 * Які джерела ввімкнено і в якому порядку (пріоритет автовибору й порядок плашок).
 * Задається у вікні налаштувань розширення; між пристроями — storage.sync, «перемагає новіший».
 * У content script значення тримаємо в пам'яті (sourcesFor синхронна): initSourcePrefs() при старті
 * і watchSourcePrefs() — щоб зміни з вікна налаштувань діяли одразу.
 */
import { storage } from '#imports';
import { syncOn } from './sync-flag';

export interface SourcePrefs {
  /** Вимкнені джерела (id), і читалки, і джерела-посилання. */
  off: string[];
  /** Порядок джерел читалки (id); джерела, яких тут немає (нові), — в кінці в порядку реєстру. */
  order: string[];
  u: number;
}

const EMPTY: SourcePrefs = { off: [], order: [], u: 0 };
const localItem = storage.defineItem<SourcePrefs>('local:hp:sources', { fallback: EMPTY });
const SYNC_KEY = 'sync:hp:sources' as const;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const norm = (p: Partial<SourcePrefs> | null | undefined): SourcePrefs => ({
  off: strings(p?.off),
  order: strings(p?.order),
  u: typeof p?.u === 'number' ? p.u : 0,
});

let cur: SourcePrefs = EMPTY;
export const sourcePrefs = () => cur;

export async function initSourcePrefs(): Promise<SourcePrefs> {
  try {
    cur = norm(await localItem.getValue());
    if (await syncOn()) {
      const rec = norm(await storage.getItem<SourcePrefs>(SYNC_KEY));
      if (rec.u > cur.u) {
        cur = rec;
        await localItem.setValue(rec);
      }
    }
  } catch (e) {
    console.warn('[Hikka Plus] source prefs', e);
  }
  return cur;
}

/** Стежити за змінами (з вікна налаштувань або з іншого пристрою). */
export function watchSourcePrefs(cb: (p: SourcePrefs) => void) {
  const unLocal = localItem.watch((v) => {
    cur = norm(v);
    cb(cur);
  });
  const unSync = storage.watch<SourcePrefs>(SYNC_KEY, async (v) => {
    if (!v || !(await syncOn())) return;
    const rec = norm(v);
    if (rec.u > cur.u) await localItem.setValue(rec);
  });
  return () => {
    unLocal();
    unSync();
  };
}

export async function setSourcePrefs(fn: (p: SourcePrefs) => Omit<SourcePrefs, 'u'>) {
  cur = norm({ ...fn(cur), u: Date.now() });
  await localItem.setValue(cur);
  if (await syncOn()) await storage.setItem(SYNC_KEY, cur).catch(() => {});
}

/** Відсортувати за порядком користувача; includeOff — разом із вимкненими (для вікна налаштувань). */
export function applySourcePrefs<T extends { id: string }>(list: T[], p = cur, includeOff = false): T[] {
  const rank = (id: string, i: number) => {
    const at = p.order.indexOf(id);
    return at < 0 ? p.order.length + i : at;
  };
  return list
    .map((x, i) => ({ x, r: rank(x.id, i) }))
    .filter(({ x }) => includeOff || !p.off.includes(x.id))
    .sort((a, b) => a.r - b.r)
    .map(({ x }) => x);
}
