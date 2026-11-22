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
export const SCOPES = ['read:readlist', 'update:readlist'];

export const hikkaConfigured = () => !!HIKKA_CLIENT.reference;

export function oauthUrl(): string {
  const q = new URLSearchParams({ reference: HIKKA_CLIENT.reference, scope: SCOPES.join(',') });
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
/** Остання помилка входу/синхронізації — показуємо в блоці. */
export const authErrorItem = storage.defineItem<string | null>('local:hp:hikkaError', { fallback: null });

// ---------- Повідомлення content → background ----------

export type ReadStatus = 'completed' | 'reading' | 'on_hold' | 'dropped' | 'planned';

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

export type HikkaRequest =
  | { type: 'hp-hikka'; op: 'exchange'; reference: string }
  | { type: 'hp-hikka'; op: 'logout' }
  | { type: 'hp-hikka'; op: 'getRead'; kind: ReadKind; slug: string }
  | { type: 'hp-hikka'; op: 'putRead'; kind: ReadKind; slug: string; read: HikkaRead };

export interface HikkaResponse<T = unknown> {
  ok: boolean;
  data?: T;
  /** 'not-found' — тайтла немає у списку; 'auth' — потрібен повторний вхід. */
  error?: 'not-found' | 'auth' | 'network' | 'other';
  message?: string;
}

async function call<T>(msg: HikkaRequest): Promise<HikkaResponse<T>> {
  const res = (await browser.runtime.sendMessage(msg)) as HikkaResponse<T> | undefined;
  return res ?? { ok: false, error: 'network', message: 'Немає відповіді від фонового скрипта' };
}

export const exchangeReference = (reference: string) =>
  call<HikkaToken>({ type: 'hp-hikka', op: 'exchange', reference });
export const logoutHikka = () => call({ type: 'hp-hikka', op: 'logout' });
export const getRead = (kind: ReadKind, slug: string) => call<HikkaRead>({ type: 'hp-hikka', op: 'getRead', kind, slug });
export const putRead = (kind: ReadKind, slug: string, read: HikkaRead) =>
  call<HikkaRead>({ type: 'hp-hikka', op: 'putRead', kind, slug, read });
