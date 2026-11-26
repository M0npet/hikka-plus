/*
 * Нові серії в озвучках (MK 2026-11-26: «не о сериях — это есть на Hikka, а о новых сериях в ОЗВУЧКАХ»).
 *
 * Що стежимо: тайтли, які користувач дивився в нашому плеєрі (є переглянута серія й обрана команда Mikai), — до MAX_TRACK.
 * Content script при відкритті тайтлу записує `local:hp:dubs[slug]` = {назва, команда, скільки серій у команди на Mikai};
 * `seen` = те саме число (користувач бачив, що вийшло). Фон раз на CHECK_EVERY_MIN питає публічний API Mikai
 * (GET api.mikai.me/public/v1/anime/hikka:<slug>/player — той самий запит, що й плеєр, Mikai дозволили) і, якщо в команди
 * серій більше, ніж `n`, оновлює `n` → лічильник на іконці (n − seen по всіх тайтлах) і, за бажанням, сповіщення браузера.
 * Свого сервера немає; запити — лише з фону, без cookie.
 */
import { storage } from '#imports';
import { teamKey } from './team-key';

export type DubTrack = {
  /** Назва тайтлу (українська, інакше англійська/японська з Hikka). */
  name: string;
  /** Ключ команди — як у плеєрі (`teamKey`). */
  team: string;
  /** Назва команди для показу. */
  tn: string;
  /** Скільки серій у команди на Mikai (найбільший номер) — за останньою перевіркою. */
  n: number;
  /** Скільки серій було, коли користувач востаннє відкривав тайтл. */
  seen: number;
  /** Коли користувач востаннє відкривав тайтл. */
  at: number;
  /** Коли востаннє з'явилася нова серія (або коли почали стежити). */
  nu: number;
};

export type DubMap = Record<string, DubTrack>;

export type DubPrefs = {
  /** Стежити за новими серіями в озвучках. */
  on: boolean;
  /** Число нових серій на іконці розширення. */
  badge: boolean;
  /** Сповіщення браузера (потрібен дозвіл notifications, необов'язковий). */
  notify: boolean;
};

export const DEFAULT_DUB_PREFS: DubPrefs = { on: true, badge: true, notify: false };
export const MAX_TRACK = 40;
export const CHECK_EVERY_MIN = 180;
/** Тайтл без нових серій і без заходів так довго — перестаємо стежити (закінчився чи кинули). */
export const STALE_MS = 60 * 86_400_000;

export const dubsItem = storage.defineItem<DubMap>('local:hp:dubs', { fallback: {} });
export const dubPrefsItem = storage.defineItem<DubPrefs>('local:hp:dubPrefs', { fallback: DEFAULT_DUB_PREFS });
/** Час останньої перевірки (мс) — щоб не питати Mikai частіше, ніж треба, і показати в налаштуваннях. */
export const dubCheckItem = storage.defineItem<number>('local:hp:dubCheck', { fallback: 0 });

export const getDubPrefs = async (): Promise<DubPrefs> => ({ ...DEFAULT_DUB_PREFS, ...(await dubPrefsItem.getValue()) });

/** Нових (непобачених) серій у тайтлі. */
export const dubNew = (t: DubTrack) => Math.max(0, t.n - t.seen);
export const dubNewTotal = (m: DubMap) => Object.values(m).reduce((s, t) => s + dubNew(t), 0);

/** Відповідь /player публічного API Mikai — лише те, що треба для підрахунку. */
type MikaiPlayerLite = {
  licensed?: boolean;
  releases?: { kind?: string; teams?: { name?: string }[]; episodes?: { number: number; sources?: { provider: string }[] }[] }[];
};

const PROVIDERS = new Set(['moon', 'ashdi', 'fenix']);

/** Найбільший номер серії команди `team` (ключ `teamKey`) — лише серії з плеєрами, які ми показуємо. 0 — немає. */
export function mikaiTeamMax(r: MikaiPlayerLite | undefined, team: string): number {
  if (!r || r.licensed) return 0;
  let max = 0;
  for (const rel of r.releases ?? []) {
    const names = (rel.teams ?? []).map((t) => t?.name?.trim()).filter(Boolean) as string[];
    if (!names.length || teamKey(names.join(' & '), rel.kind === 'sub') !== team) continue;
    for (const ep of rel.episodes ?? [])
      if (Number.isFinite(ep.number) && ep.number > max && (ep.sources ?? []).some((s) => PROVIDERS.has(s.provider))) max = ep.number;
  }
  return max;
}

// Записи з різних вкладок і фону — по черзі.
let queue: Promise<unknown> = Promise.resolve();
export function updateDubs(fn: (m: DubMap) => DubMap): Promise<void> {
  const next = queue.then(async () => dubsItem.setValue(fn({ ...(await dubsItem.getValue()) })));
  queue = next.catch(() => {});
  return next;
}

/** Найменш потрібні тайтли — геть, щоб лишилось ≤ MAX_TRACK і без давно мертвих. */
export function pruneDubs(m: DubMap, now = Date.now()): DubMap {
  const live = Object.entries(m).filter(([, t]) => now - Math.max(t.at, t.nu) < STALE_MS);
  live.sort(([, a], [, b]) => Math.max(b.at, b.nu) - Math.max(a.at, a.nu));
  return Object.fromEntries(live.slice(0, MAX_TRACK));
}

/**
 * Content script, тайтл відкрито: стежити за командою, яку користувач дивиться (якщо вже щось переглянув),
 * і вважати все, що вийшло, побаченим. n — серій у команди на Mikai (0 — команди на Mikai немає: не стежимо).
 */
export async function noteDubSeen(slug: string, t: { name: string; team: string; tn: string; n: number }) {
  if (!(await getDubPrefs()).on) return;
  const now = Date.now();
  await updateDubs((m) => {
    const cur = m[slug];
    if (!t.n) {
      if (cur?.team === t.team) delete m[slug];
      return m;
    }
    const keep = cur && cur.team === t.team && cur.n === t.n;
    m[slug] = { name: t.name, team: t.team, tn: t.tn, n: t.n, seen: t.n, at: now, nu: keep ? cur.nu : now };
    return pruneDubs(m, now);
  });
}

export const forgetDub = (slug: string) =>
  updateDubs((m) => {
    delete m[slug];
    return m;
  });

/** Повідомлення сторінки налаштувань фону: перевірити зараз. */
export type DubCheckRequest = { type: 'hp-dubs'; op: 'check' };
export type DubCheckResult = { ok: boolean; found: number; error?: string };
