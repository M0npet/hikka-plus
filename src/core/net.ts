import { browser } from '#imports';

/** Повідомлення content → background. */
export interface FetchRequest {
  type: 'hp-fetch';
  url: string;
  method?: 'GET' | 'POST';
  /** Тіло POST у форматі application/x-www-form-urlencoded. */
  form?: string;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  body: string;
  error?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Запит через background: там є host_permissions, тож CORS не заважає.
 * Куки сторонніх сайтів не надсилаються.
 */
export async function getText(url: string, init?: { form?: URLSearchParams }): Promise<string> {
  const msg: FetchRequest = init?.form
    ? { type: 'hp-fetch', url, method: 'POST', form: init.form.toString() }
    : { type: 'hp-fetch', url };
  const res = (await browser.runtime.sendMessage(msg)) as FetchResponse | undefined;
  if (!res) throw new HttpError(0, 'Немає відповіді від фонового скрипта');
  if (!res.ok) throw new HttpError(res.status, res.error || `HTTP ${res.status}`);
  return res.body;
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}

export async function getDoc(url: string, init?: { form?: URLSearchParams }): Promise<Document> {
  return new DOMParser().parseFromString(await getText(url, init), 'text/html');
}
