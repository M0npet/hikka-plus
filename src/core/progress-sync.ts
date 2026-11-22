/**
 * Прогрес між пристроями без власного сервера: storage.sync
 * (Firefox Sync / синхронізація Chrome). Ліміти: ~100 КБ усього, 8 КБ на ключ,
 * 512 ключів, у Chrome 120 записів/хв і 1800/год — тож пишемо стисло й рідко.
 *
 * Запис на тайтл: { r: "1-205,207,12.5", l: [ключ, позиція, джерело, id розділу], u: час }.
 * Позиція всередині зберігається лише для останнього відкритого розділу.
 * Конфлікти — «перемагає новіший» (u).
 */
import { storage } from '#imports';
import type { ReadKind } from './page';
import type { Progress } from './store';

interface SyncRecord {
  r: string;
  l?: [string, number, string, string];
  u: number;
}

const PREFIX = 'hp:p:';
const MAX_TITLES = 400; // запас до ліміту 512 ключів
const DEBOUNCE_MS = 10_000;

const syncKey = (kind: ReadKind, slug: string) => `sync:${PREFIX}${kind === 'manga' ? 'm' : 'n'}:${slug}` as const;

// ---------- Стиснення списку прочитаних ----------

/** ["1","2","3","5","7.5"] → "1-3,5,7.5" (нечислові ключі — через encodeURIComponent). */
export function encodeRead(keys: string[]): string {
  const ints: number[] = [];
  const other: string[] = [];
  for (const k of keys) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 0 && String(n) === k) ints.push(n);
    else other.push(Number.isFinite(n) && String(n) === k ? k : encodeURIComponent(k).replace(/-/g, '%2D'));
  }
  ints.sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ints.length; ) {
    let j = i;
    while (j + 1 < ints.length && ints[j + 1]! - ints[j]! <= 1) j++;
    parts.push(j > i ? `${ints[i]}-${ints[j]}` : `${ints[i]}`);
    i = j + 1;
  }
  return [...parts, ...other].join(',');
}

export function decodeRead(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(',')) {
    if (!part) continue;
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Math.min(Number(m[2]), a + 20000);
      for (let i = a; i <= b; i++) out.push(String(i));
    } else {
      try {
        out.push(decodeURIComponent(part));
      } catch {
        /* пошкоджений шматок — пропускаємо */
      }
    }
  }
  return out;
}

function toRecord(p: Progress): SyncRecord {
  const read = Object.entries(p.chapters)
    .filter(([, c]) => c.read)
    .map(([k]) => k);
  const rec: SyncRecord = { r: encodeRead(read), u: p.updatedAt };
  if (p.last) {
    const pos = p.chapters[p.last.key]?.pos ?? 0;
    rec.l = [p.last.key, Math.round(pos * 1000) / 1000, p.last.sourceId, p.last.chapterId];
  }
  return rec;
}

/** Накласти запис із sync на локальний прогрес (запис новіший). */
function applyRecord(local: Progress, rec: SyncRecord): Progress {
  const readSet = new Set(decodeRead(rec.r));
  const chapters: Progress['chapters'] = {};
  for (const [k, c] of Object.entries(local.chapters)) {
    chapters[k] = readSet.has(k) ? { ...c, read: true, pos: 1 } : { ...c, read: false, pos: c.read ? 0 : c.pos };
  }
  for (const k of readSet) if (!chapters[k]) chapters[k] = { pos: 1, read: true, at: rec.u };
  let last = local.last;
  if (rec.l) {
    const [key, pos, sourceId, chapterId] = rec.l;
    last = { key, label: '', sourceId, chapterId };
    if (!readSet.has(key)) chapters[key] = { pos, read: false, at: rec.u };
  }
  return { last, chapters, updatedAt: rec.u };
}

// ---------- Обмін ----------

type Io = {
  get: () => Promise<Progress>;
  /** Записати локально БЕЗ зміни updatedAt і без повторної відправки в sync. */
  setRaw: (p: Progress) => Promise<void>;
};

/** Підтягнути запис із sync, якщо він новіший за локальний. */
export async function pullProgress(kind: ReadKind, slug: string, io: Io) {
  try {
    const rec = await storage.getItem<SyncRecord>(syncKey(kind, slug));
    const local = await io.get();
    if (rec && rec.u > local.updatedAt) await io.setRaw(applyRecord(local, rec));
    else if (!rec && local.updatedAt > 0) schedulePush(kind, slug, io);
  } catch (e) {
    console.warn('[Hikka Plus] sync pull', e);
  }
}

/** Стежити за змінами з інших пристроїв, поки відкрита сторінка тайтлу. */
export function watchSynced(kind: ReadKind, slug: string, io: Io) {
  return storage.watch<SyncRecord>(syncKey(kind, slug), async (rec) => {
    if (!rec) return;
    const local = await io.get();
    if (rec.u > local.updatedAt) await io.setRaw(applyRecord(local, rec));
  });
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function schedulePush(kind: ReadKind, slug: string, io: Pick<Io, 'get'>) {
  const key = syncKey(kind, slug);
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void push(kind, slug, io);
    }, DEBOUNCE_MS),
  );
}

async function push(kind: ReadKind, slug: string, io: Pick<Io, 'get'>) {
  const key = syncKey(kind, slug);
  try {
    const rec = toRecord(await io.get());
    const prev = await storage.getItem<SyncRecord>(key);
    if (prev && prev.u >= rec.u) return; // там уже новіше або те саме
    if (!prev) await prune();
    await storage.setItem(key, rec);
  } catch (e) {
    // Переповнення квоти чи ліміт записів — локальний прогрес усе одно збережено.
    console.warn('[Hikka Plus] sync push', e);
  }
}

/** Тримати не більше MAX_TITLES тайтлів у sync: найстаріші видаляємо. */
async function prune() {
  const all = (await storage.snapshot('sync')) as Record<string, unknown>;
  const mine = Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([k, v]) => ({ k, u: (v as SyncRecord | null)?.u ?? 0 }));
  if (mine.length < MAX_TITLES) return;
  mine.sort((a, b) => a.u - b.u);
  const drop = mine.slice(0, mine.length - MAX_TITLES + 1).map((x) => `sync:${x.k}` as const);
  await storage.removeItems(drop);
}
