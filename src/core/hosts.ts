/**
 * Домени, до яких розширенню дозволено робити запити (через background).
 * Додаючи нове джерело — додай сюди його API-хост: звідси збираються
 * і host_permissions у маніфесті, і allowlist у background.
 */
export const API_HOSTS = ['https://api.hikka.io', 'https://api.zenko.online'] as const;

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && API_HOSTS.some((h) => new URL(h).host === u.host);
  } catch {
    return false;
  }
}
