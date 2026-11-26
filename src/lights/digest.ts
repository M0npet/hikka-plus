/*
 * Мережа для пристроїв: fetch з тайм-аутом і HTTP Digest (Philips Android TV). У WebCrypto немає MD5 — своя реалізація.
 * credentials:'omit' — щоб браузер не показував власне вікно входу на 401.
 */

const TIMEOUT = 4000;

export function lfetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) });
}

export async function ljson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await lfetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/* ---------- MD5 (RFC 1321) над UTF-8 ---------- */

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

function md5(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2]! |= bytes[i]! << ((i % 4) * 8);
  words[len >> 2]! |= 0x80 << ((len % 4) * 8);
  words[words.length - 2] = (len * 8) >>> 0;
  words[words.length - 1] = Math.floor(len / 2 ** 29);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let off = 0; off < words.length; off += 16) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i]! + words[off + g]!) >>> 0;
      const s = S[(i >> 4) * 4 + (i % 4)]!;
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((v) => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join(''))
    .join('');
}

/* ---------- Digest ---------- */

type Challenge = { realm: string; nonce: string; qop?: string; opaque?: string; algorithm?: string };

function parseChallenge(h: string | null): Challenge | null {
  if (!h || !/^digest\s/i.test(h)) return null;
  const o: Record<string, string> = {};
  for (const m of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) o[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? '';
  if (!o.nonce) return null;
  return { realm: o.realm ?? '', nonce: o.nonce, qop: o.qop, opaque: o.opaque, algorithm: o.algorithm };
}

/** Останній виклик сервера на хост — щоб не отримувати 401 на кожен кадр. */
const challenges = new Map<string, { ch: Challenge; nc: number }>();

function authHeader(c: { ch: Challenge; nc: number }, method: string, uri: string, user: string, pass: string) {
  const { ch } = c;
  const nc = (++c.nc).toString(16).padStart(8, '0');
  const cnonce = Math.random().toString(16).slice(2, 18);
  const ha1 = md5(`${user}:${ch.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = ch.qop?.split(',').map((s) => s.trim()).includes('auth') ? 'auth' : undefined;
  const response = qop ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${ch.nonce}:${ha2}`);
  const parts = [
    `username="${user}"`,
    `realm="${ch.realm}"`,
    `nonce="${ch.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    ch.algorithm && `algorithm=${ch.algorithm}`,
    ch.opaque && `opaque="${ch.opaque}"`,
    qop && `qop=${qop}, nc=${nc}, cnonce="${cnonce}"`,
  ].filter(Boolean);
  return `Digest ${parts.join(', ')}`;
}

export async function digestFetch(url: string, init: RequestInit, user: string, pass: string): Promise<Response> {
  const u = new URL(url);
  const method = (init.method ?? 'GET').toUpperCase();
  let c = challenges.get(u.host);
  for (let attempt = 0; ; attempt++) {
    const headers = new Headers(init.headers);
    if (c) headers.set('Authorization', authHeader(c, method, u.pathname + u.search, user, pass));
    const res = await lfetch(url, { ...init, headers });
    if (res.status !== 401 || attempt > 0) return res;
    const ch = parseChallenge(res.headers.get('WWW-Authenticate'));
    if (!ch) return res;
    c = { ch, nc: 0 };
    challenges.set(u.host, c);
  }
}
