import { browser } from '#imports';

/** Повідомлення content → background. */
export interface FetchRequest {
  type: 'hp-fetch';
  url: string;
  method?: 'GET' | 'POST';
  /** Тіло POST у форматі application/x-www-form-urlencoded. */
  form?: string;
  /** Тіло POST як JSON (рядок). */
  json?: string;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  body: string;
  error?: string;
  /** Заголовок Retry-After (на 429/503). */
  retryAfter?: string | null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
  /** `String(e)` у повідомленнях інтерфейсу — без «Error: ». */
  override toString() {
    return this.message;
  }
}

/** Текст для 429: сайт обмежує частоту запитів. */
export const RATE_LIMIT_TEXT = 'Сайт просить почекати — спробуйте за хвилину';

/** Сайт обмежив частоту (429) — запит не робили або він не пройшов. */
export const isRateLimit = (e: unknown) => e instanceof HttpError && e.status === 429;

/** Для `catch` у пошуку/автопідборі: «не знайшлося» ковтаємо, а 429 — ні (інакше тайтл запишеться як «немає»). */
export function rethrowRateLimit(e: unknown) {
  if (isRateLimit(e)) throw e;
}

// Хост → до якого часу не чіпати (після 429). Поки пауза — запити до нього не йдуть зовсім:
// автопідбір, «нових розділів» і пошук не добивають сайт, що вже попросив почекати.
const cooldown = new Map<string, number>();
const DEFAULT_PAUSE_MS = 60_000;
const MAX_PAUSE_MS = 10 * 60_000;

function pauseFor(retryAfter: string | null | undefined): number {
  const v = retryAfter?.trim();
  if (v) {
    const sec = Number(v);
    const ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(v) - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_PAUSE_MS);
  }
  return DEFAULT_PAUSE_MS;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/**
 * Запит через background: там є host_permissions, тож CORS не заважає.
 * Куки сторонніх сайтів не надсилаються.
 */
/**
 * Фон (entrypoints/background.ts) ставить сюди свій обробник hp-fetch: тоді запити з фону йдуть напряму, а не
 * runtime.sendMessage самому собі (так не працює). Завдяки цьому джерела читання (src/sources) працюють і з фону —
 * перевірка нових розділів (src/features/chapter-check.ts). getDoc у фоні — лише де є DOMParser (Firefox MV2).
 */
let direct: ((m: FetchRequest) => Promise<FetchResponse>) | null = null;
export function setDirectFetch(f: (m: FetchRequest) => Promise<FetchResponse>) {
  direct = f;
}

export async function getText(url: string, init?: { form?: URLSearchParams; json?: unknown }): Promise<string> {
  const msg: FetchRequest = init?.form
    ? { type: 'hp-fetch', url, method: 'POST', form: init.form.toString() }
    : init?.json !== undefined
      ? { type: 'hp-fetch', url, method: 'POST', json: JSON.stringify(init.json) }
      : { type: 'hp-fetch', url };
  const host = hostOf(url);
  if ((cooldown.get(host) ?? 0) > Date.now()) throw new HttpError(429, RATE_LIMIT_TEXT);
  const res = direct ? await direct(msg) : ((await browser.runtime.sendMessage(msg)) as FetchResponse | undefined);
  if (!res) throw new HttpError(0, 'Немає відповіді від фонового скрипта');
  if (res.status === 429) {
    cooldown.set(host, Date.now() + pauseFor(res.retryAfter));
    throw new HttpError(429, RATE_LIMIT_TEXT);
  }
  if (!res.ok) throw new HttpError(res.status, res.error || `HTTP ${res.status}`);
  return res.body;
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return JSON.parse(await getText(url, { json: body })) as T;
}

export async function getDoc(url: string, init?: { form?: URLSearchParams }): Promise<Document> {
  return new DOMParser().parseFromString(await getText(url, init), 'text/html');
}
