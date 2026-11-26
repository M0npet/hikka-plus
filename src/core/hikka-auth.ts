import { browser, storage } from '#imports';
import type { ReadKind } from './page';

/**
 * Вхід у Hikka через її OAuth для сторонніх застосунків.
 *
 * Клієнт створює власник розширення на hikka.io → Налаштування → Застосунки,
 * endpoint: https://hikka.io/hikka-plus-auth. Hikka після підтвердження
 * перекидає туди з ?reference=…, наш content script ловить цю адресу,
 * а background міняє reference + секрет клієнта на токен (POST /auth/token).
 *
 * Reference і секрет клієнта задаються під час збірки (WXT_HIKKA_CLIENT_*:
 * .env.local локально, секрети репо в CI) і в репозиторій не потрапляють.
 * У зібраному розширенні секрет видно — так у будь-якого клієнта без сервера;
 * ним не можна нічого зробити без згоди користувача на сторінці Hikka.
 */
export const HIKKA_CLIENT = {
  reference: (import.meta.env.WXT_HIKKA_CLIENT_REFERENCE as string | undefined) ?? '',
};

export const AUTH_PATH = '/hikka-plus-auth';
const SCOPES = ['read:readlist', 'update:readlist'];
/**
 * Дозволи для відміток серій. Просимо окремо (кнопкою в блоці «Перегляд»), а не при звичайному вході:
 * якщо в клієнті Hikka їх ще не ввімкнули, звичайний вхід не має зламатися.
 */
const WATCH_SCOPES = ['read:watchlist', 'update:watchlist'];

export const hikkaConfigured = () => !!HIKKA_CLIENT.reference;

export function oauthUrl(watch = false): string {
  const scope = watch ? [...SCOPES, ...WATCH_SCOPES] : SCOPES;
  const q = new URLSearchParams({ reference: HIKKA_CLIENT.reference, scope: scope.join(',') });
  return `https://hikka.io/oauth?${q}`;
}

export interface HikkaToken {
  secret: string;
  /** unix seconds */
  expiration: number;
}

/** Токен живе тільки в local (не в sync): на кожному пристрої вхід свій. */
export const tokenItem = storage.defineItem<HikkaToken | null>('local:hp:hikkaToken', { fallback: null });
/** Куди повернутися після входу. */
export const returnItem = storage.defineItem<string | null>('local:hp:authReturn', { fallback: null });
/** Поточний токен має дозволи на список перегляду (вхід через «Відмічати серії в Hikka»). */
export const watchScopeItem = storage.defineItem<boolean>('local:hp:hikkaWatchScope', { fallback: false });
/** Вхід почато з дозволами на перегляд — після повернення запам'ятати це. */
export const watchLoginItem = storage.defineItem<boolean>('local:hp:hikkaWatchLogin', { fallback: false });
/** Остання помилка входу/синхронізації — показуємо в блоці. */
export const authErrorItem = storage.defineItem<string | null>('local:hp:hikkaError', { fallback: null });

// ---------- Повідомлення content → background ----------

type ReadStatus = 'completed' | 'reading' | 'on_hold' | 'dropped' | 'planned';

export interface HikkaRead {
  status: ReadStatus;
  chapters: number;
  volumes: number;
  rereads: number;
  score: number;
  note: string | null;
  start_date: number | null;
  end_date: number | null;
}

type WatchStatus = 'completed' | 'watching' | 'on_hold' | 'dropped' | 'planned';

export interface HikkaWatch {
  status: WatchStatus;
  episodes: number;
  rewatches: number;
  score: number;
  note: string | null;
  start_date: number | null;
  end_date: number | null;
}

export type HikkaRequest =
  | { type: 'hp-hikka'; op: 'exchange'; reference: string }
  | { type: 'hp-hikka'; op: 'logout' }
  /** Чи є згода Firefox на передачу даних у Hikka; open — немає → відкрити вкладку налаштувань «Hikka», де її можна дати. */
  | { type: 'hp-hikka'; op: 'consent'; open?: boolean }
  | { type: 'hp-hikka'; op: 'getRead'; kind: ReadKind; slug: string }
  | { type: 'hp-hikka'; op: 'putRead'; kind: ReadKind; slug: string; read: HikkaRead }
  | { type: 'hp-hikka'; op: 'getWatch'; slug: string }
  | { type: 'hp-hikka'; op: 'putWatch'; slug: string; watch: HikkaWatch };

export interface HikkaResponse<T = unknown> {
  ok: boolean;
  data?: T;
  /** 'not-found' — тайтла немає у списку; 'auth' — потрібен повторний вхід; 'scope' — у токена немає потрібного дозволу. */
  error?: 'not-found' | 'auth' | 'scope' | 'network' | 'other';
  message?: string;
}

async function call<T>(msg: HikkaRequest): Promise<HikkaResponse<T>> {
  const res = (await browser.runtime.sendMessage(msg)) as HikkaResponse<T> | undefined;
  return res ?? { ok: false, error: 'network', message: 'Немає відповіді від фонового скрипта' };
}

/**
 * Firefox (0.6.1, MK 2026-11-25 00:58): токен входу (authenticationInfo) і прочитане/переглянуте в список Hikka (websiteActivity)
 * — НЕобов'язкова згода в data_collection_permissions. Просимо при «Увійти» (лише зі сторінки розширення — у content script
 * permissions API немає); без згоди не входимо й нічого в Hikka не шлемо. У Chrome такої згоди немає — завжди так.
 */
const HIKKA_DATA = ['authenticationInfo', 'websiteActivity'];
type Perms = Parameters<typeof browser.permissions.request>[0];
const hikkaPerms = () => ({ data_collection: HIKKA_DATA }) as Perms;

export async function hikkaDataOk(): Promise<boolean> {
  if (!import.meta.env.FIREFOX) return true;
  try {
    const all = (await browser.permissions.getAll()) as { data_collection?: string[] };
    return HIKKA_DATA.every((d) => all.data_collection?.includes(d));
  } catch {
    return false;
  }
}

/** Попросити згоду (у Chrome — нічого не питаємо). Викликати першим ділом в обробнику кліку — потрібен жест користувача. */
export function requestHikkaData(): Promise<boolean> {
  return import.meta.env.FIREFOX ? browser.permissions.request(hikkaPerms()) : Promise.resolve(true);
}

/** З content script: є згода? Немає — фон відкриє вкладку налаштувань «Hikka». */
export const hikkaConsent = (open = false) => call<boolean>({ type: 'hp-hikka', op: 'consent', open });

export const exchangeReference = (reference: string) =>
  call<HikkaToken>({ type: 'hp-hikka', op: 'exchange', reference });
export const logoutHikka = () => call({ type: 'hp-hikka', op: 'logout' });
export const getRead = (kind: ReadKind, slug: string) => call<HikkaRead>({ type: 'hp-hikka', op: 'getRead', kind, slug });
export const putRead = (kind: ReadKind, slug: string, read: HikkaRead) =>
  call<HikkaRead>({ type: 'hp-hikka', op: 'putRead', kind, slug, read });
export const getWatch = (slug: string) => call<HikkaWatch>({ type: 'hp-hikka', op: 'getWatch', slug });
export const putWatch = (slug: string, watch: HikkaWatch) => call<HikkaWatch>({ type: 'hp-hikka', op: 'putWatch', slug, watch });
