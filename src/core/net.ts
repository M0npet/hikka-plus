import { browser } from '#imports';

/** Повідомлення content → background. */
export interface FetchRequest {
  type: 'hp-fetch';
  url: string;
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
 * GET-запит через background: там є host_permissions, тож CORS не заважає.
 * Куки сторонніх сайтів не надсилаються.
 */
export async function getText(url: string): Promise<string> {
  const msg: FetchRequest = { type: 'hp-fetch', url };
  const res = (await browser.runtime.sendMessage(msg)) as FetchResponse | undefined;
  if (!res) throw new HttpError(0, 'Немає відповіді від фонового скрипта');
  if (!res.ok) throw new HttpError(res.status, res.error || `HTTP ${res.status}`);
  return res.body;
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}
