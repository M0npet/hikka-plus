/**
 * Дані розширення для розділу «Дані»: підрахунок, резервна копія (експорт/імпорт), скидання.
 * Вхід у Hikka (токен) у копію не йде і не скидається — він свій на кожному пристрої.
 */
import { storage } from '#imports';
import { syncOn } from '../core/sync-flag';

/** Локальні ключі, яких не буває в копії: токен входу й службові стани. */
const PRIVATE = new Set(['hp:hikkaToken', 'hp:authReturn', 'hp:hikkaError']);
const isOurs = (k: string) => k.startsWith('hp:') && !PRIVATE.has(k);

const PROGRESS = { local: 'hp:progress2:', sync: 'hp:p:' };
const BINDINGS = { local: 'hp:bind2:', sync: 'hp:b:' };

async function snap(area: 'local' | 'sync'): Promise<Record<string, unknown>> {
  try {
    return (await storage.snapshot(area)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface DataStats {
  progress: number;
  bindings: number;
}

export async function dataStats(): Promise<DataStats> {
  const keys = Object.keys(await snap('local'));
  return {
    progress: keys.filter((k) => k.startsWith(PROGRESS.local)).length,
    bindings: keys.filter((k) => k.startsWith(BINDINGS.local)).length,
  };
}

interface Backup {
  app: 'hikka-plus';
  v: 1;
  at: string;
  local: Record<string, unknown>;
  sync: Record<string, unknown>;
}

const pick = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => isOurs(k)));

export async function exportData(): Promise<{ name: string; json: string }> {
  const b: Backup = {
    app: 'hikka-plus',
    v: 1,
    at: new Date().toISOString(),
    local: pick(await snap('local')),
    sync: pick(await snap('sync')),
  };
  return { name: `hikka-plus-${b.at.slice(0, 10)}.json`, json: JSON.stringify(b) };
}

/** Відновити з копії: записи з копії замінюють поточні з тими самими ключами, решта лишається. */
export async function importData(text: string): Promise<number> {
  let b: Partial<Backup>;
  try {
    b = JSON.parse(text) as Partial<Backup>;
  } catch {
    throw new Error('Це не файл JSON');
  }
  if (b?.app !== 'hikka-plus' || typeof b.local !== 'object' || !b.local) {
    throw new Error('Це не резервна копія Hikka Plus');
  }
  const local = Object.entries(b.local).filter(([k]) => isOurs(k));
  const sync = (await syncOn()) && b.sync && typeof b.sync === 'object' ? Object.entries(b.sync).filter(([k]) => isOurs(k)) : [];
  if (local.length) await storage.setItems(local.map(([k, value]) => ({ key: `local:${k}` as const, value })));
  if (sync.length) await storage.setItems(sync.map(([k, value]) => ({ key: `sync:${k}` as const, value }))).catch(() => {});
  return local.length;
}

async function removeByPrefix(p: { local: string; sync: string }) {
  const local = Object.keys(await snap('local')).filter((k) => k.startsWith(p.local));
  const sync = Object.keys(await snap('sync')).filter((k) => k.startsWith(p.sync));
  await storage.removeItems(local.map((k) => `local:${k}` as const));
  await storage.removeItems(sync.map((k) => `sync:${k}` as const)).catch(() => {});
}

export const resetProgress = () => removeByPrefix(PROGRESS);
export const resetBindings = () => removeByPrefix(BINDINGS);

/** Усе, крім входу в Hikka. */
export async function resetAll() {
  const local = Object.keys(await snap('local')).filter(isOurs);
  const sync = Object.keys(await snap('sync')).filter(isOurs);
  await storage.removeItems(local.map((k) => `local:${k}` as const));
  await storage.removeItems(sync.map((k) => `sync:${k}` as const)).catch(() => {});
}
