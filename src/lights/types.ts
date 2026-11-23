/*
 * Підсвітка пристроїв від відео (експериментально, MK 2026-11-23): Philips TV Ambilight, WLED, Philips Hue, Razer Chroma.
 * Кадр 32×18 (той самий, що для підсвітки навколо плеєра) іде з блоку «Перегляд» у background (`hp-lights`),
 * там src/lights/engine.ts розсилає кольори на пристрої в домашній мережі користувача. Нікуди більше кадр не йде.
 * Протоколи й джерела — claude/research-device-lights.md у claude.ai-проєкті.
 */
import { storage } from '#imports';

/** Кадр: w×h пікселів, rgb — рядок, по символу на байт (як AMBIENT_MSG). */
export type Frame = { w: number; h: number; rgb: string };
export type RGB = [number, number, number];

export type PhilipsConf = {
  host: string;
  /** Старі ТВ без Android: http :1925 без входу. */
  plain?: boolean;
  /** Android-ТВ (https :1926): digest, логін = id пристрою, пароль = auth_key з pairing. */
  user?: string;
  pass?: string;
  on: boolean;
};
export type WledConf = { host: string; on: boolean };
export type HueConf = { host: string; user: string; on: boolean };
export type RazerConf = { on: boolean };

export type LightsConf = {
  philips?: PhilipsConf;
  wled?: WledConf;
  hue?: HueConf;
  razer?: RazerConf;
};

export type DeviceKind = keyof LightsConf;

export const lightsItem = storage.defineItem<LightsConf>('local:hp:lights', { fallback: {} });

/** Повідомлення в background від блоку «Перегляд»: кадр або «зупинити» (пристрої повертаються у свій режим). */
export type LightsMsg = { type: 'hp-lights'; frame?: Frame; stop?: true };

/** Хост із поля вводу: «192.168.1.50» або «http://wled.local/» → «192.168.1.50» / «wled.local». null — не схоже на хост. */
export function cleanHost(raw: string): string | null {
  const s = raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  return /^[a-z0-9.-]+$/i.test(s) && s.length <= 253 ? s.toLowerCase() : null;
}

/** Дозвіл на хост пристрою (optional host permissions) — порт у шаблоні не вказується. */
export const hostOrigins = (host: string) => [`http://${host}/*`, `https://${host}/*`];
/** Razer Chroma SDK: REST на localhost (або chromasdk.io → 127.0.0.1 з сертифікатом). */
export const RAZER_ORIGINS = ['http://localhost/*', 'https://chromasdk.io/*'];
