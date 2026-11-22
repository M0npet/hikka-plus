/**
 * Домени, до яких розширенню дозволено робити запити (через background).
 * Додаючи нове джерело — додай сюди його хост: звідси збираються
 * і host_permissions у маніфесті, і allowlist у background.
 */
export const API_HOSTS = [
  'https://api.hikka.io',
  'https://api.zenko.online',
  'https://manga.in.ua',
  'https://baka.in.ua',
] as const;

/** Хости, яким потрібен заголовок X-Requested-With (AJAX-ендпоінти DLE). */
export const XHR_HOSTS = new Set(['manga.in.ua']);

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && API_HOSTS.some((h) => new URL(h).host === u.host);
  } catch {
    return false;
  }
}
