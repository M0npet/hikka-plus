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
  'https://data.api.honey-manga.com.ua',
  'https://search.api.honey-manga.com.ua',
  'https://uamanga.com',
  'https://back.animesvit.com',
  'https://dgmanga.app',
  'https://runi.ink',
  'https://api.smakolykytl.site',
  'https://novel.org.ua',
  'https://fan-vers.com',
  'https://www.wattpad.com',
  // Плеєр аніме: дані про серії (самі плеєри — iframe, запитів до них не робимо) і мітки ендингу.
  'https://api.mikai.me',
  'https://animeon.club',
  'https://api.aniskip.com',
  // Джерела-посилання (лише пошук тайтлу, без читання).
  'https://mangra.app',
  'https://faust-web.com',
  'https://mangarama.com.ua',
  'https://manga.valsky.org',
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
