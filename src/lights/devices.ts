/*
 * Драйвери пристроїв. Кожен: start() — підготувати (зберегти стан, увімкнути ручний режим), send(кадр), stop() — повернути як було.
 * minGap — найменший проміжок між кадрами для цього пристрою (повільні пристрої пропускають кадри).
 */
import { average, differs, edge, hex, perimeter, type Side } from './color';
import { digestFetch, jsonBody, lfetch, ljson } from './digest';
import type { Frame, HueConf, PhilipsConf, RGB, WledConf } from './types';

export type Driver = {
  name: string;
  minGap: number;
  start(): Promise<void>;
  send(f: Frame): Promise<void>;
  stop(): Promise<void>;
};

const ok = (res: Response) => {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
};

/* ---------- Philips TV Ambilight (JointSpace API 6) ---------- */

/** Ключ підпису pairing — з haphilipsjs (бібліотека інтеграції Philips TV у Home Assistant). */
const PHILIPS_KEY_B64 = 'ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==';

const philipsBase = (c: { host: string; plain?: boolean }) =>
  c.plain ? `http://${c.host}:1925/6/` : `https://${c.host}:1926/6/`;

function philipsReq(c: PhilipsConf, path: string, init: RequestInit = {}) {
  const url = philipsBase(c) + path;
  return c.user && c.pass ? digestFetch(url, init, c.user, c.pass) : lfetch(url, init);
}

type Topology = { layers: number; left: number; top: number; right: number; bottom: number };

export function philipsDriver(c: PhilipsConf): Driver {
  let topo: Topology | null = null;
  return {
    name: 'Philips TV',
    minGap: 100,
    async start() {
      topo = (await ok(await philipsReq(c, 'ambilight/topology')).json()) as Topology;
      ok(await philipsReq(c, 'ambilight/mode', jsonBody('POST', { current: 'manual' })));
    },
    async send(f) {
      if (!topo) return;
      const layer: Partial<Record<Side, Record<string, { r: number; g: number; b: number }>>> = {};
      for (const side of ['left', 'top', 'right', 'bottom'] as Side[]) {
        const n = topo[side] | 0;
        if (n <= 0) continue;
        layer[side] = Object.fromEntries(edge(f, side, n).map(([r, g, b], i) => [String(i), { r, g, b }]));
      }
      const body: Record<string, unknown> = {};
      for (let l = 1; l <= Math.max(1, topo.layers | 0); l++) body[`layer${l}`] = layer;
      ok(await philipsReq(c, 'ambilight/cached', jsonBody('POST', body)));
    },
    async stop() {
      await philipsReq(c, 'ambilight/mode', jsonBody('POST', { current: 'internal' }));
    },
  };
}

/** Тип пристрою, яким ми представляємося телевізору при pairing. */
function philipsDevice(id: string) {
  return { device_name: 'Hikka Plus', device_os: 'Android', app_id: 'app.id', app_name: 'Hikka Plus', type: 'native', id };
}

export type PhilipsPairing = { host: string; id: string; authKey: string; timestamp: number };

/**
 * Крок 1: Android-ТВ (https :1926) показує PIN на екрані. Якщо https не відповідає — пробуємо старий API (http :1925, без входу).
 * Повертає або очікування PIN, або готову конфігурацію для старого ТВ.
 */
export async function philipsPairRequest(host: string): Promise<{ pairing: PhilipsPairing } | { conf: PhilipsConf }> {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const r = await ljson<{ error_id?: string; auth_key?: string; timestamp?: number }>(
      philipsBase({ host }) + 'pair/request',
      jsonBody('POST', { access: { scope: ['read', 'write', 'control'] }, device: philipsDevice(id) }),
    );
    if (r.error_id !== 'SUCCESS' || !r.auth_key || r.timestamp === undefined) throw new Error(r.error_id ?? 'pair/request');
    return { pairing: { host, id, authKey: r.auth_key, timestamp: r.timestamp } };
  } catch (e) {
    // Старі ТВ без Android: без pairing.
    const plain = await lfetch(philipsBase({ host, plain: true }) + 'ambilight/topology').catch(() => null);
    if (plain?.ok) return { conf: { host, plain: true, on: true } };
    throw e;
  }
}

/** Підпис pairing: base64(HMAC-SHA1(ключ, timestamp + pin)) — як у haphilipsjs. */
async function philipsSignature(timestamp: number, pin: string): Promise<string> {
  const raw = Uint8Array.from(atob(PHILIPS_KEY_B64), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}${pin}`)));
  return btoa(String.fromCharCode(...sig));
}

/** Крок 2: PIN з екрана ТВ → логін/пароль для digest. */
export async function philipsPairGrant(p: PhilipsPairing, pin: string): Promise<PhilipsConf> {
  const body = {
    auth: { auth_appId: '1', pin, auth_timestamp: p.timestamp, auth_signature: await philipsSignature(p.timestamp, pin) },
    device: philipsDevice(p.id),
  };
  const res = await digestFetch(philipsBase({ host: p.host }) + 'pair/grant', jsonBody('POST', body), p.id, p.authKey);
  const r = (await res.json().catch(() => ({}))) as { error_id?: string };
  if (r.error_id !== 'SUCCESS') throw new Error(r.error_id ?? `HTTP ${res.status}`);
  return { host: p.host, user: p.id, pass: p.authKey, on: true };
}

/* ---------- WLED ---------- */

/** Більше світлодіодів в одному JSON WLED може не прийняти (буфер запиту). */
const WLED_MAX = 300;

export function wledDriver(c: WledConf): Driver {
  const base = `http://${c.host}/json/`;
  let count = 0;
  let wasOn = true;
  return {
    name: 'WLED',
    minGap: 100,
    async start() {
      const info = await ljson<{ leds?: { count?: number } }>(base + 'info');
      count = Math.min(WLED_MAX, info.leds?.count ?? 0);
      if (!count) throw new Error('0 LED');
      const st = await ljson<{ on?: boolean }>(base + 'state');
      wasOn = st.on !== false;
    },
    async send(f) {
      // seg.i — кольори світлодіодів підряд з 0; сегмент «заморожується», поки не скинемо frz.
      ok(await lfetch(base + 'state', jsonBody('POST', { on: true, tt: 0, seg: { i: perimeter(f, count).map(hex) } })));
    },
    async stop() {
      await lfetch(base + 'state', jsonBody('POST', { on: wasOn, seg: { frz: false } }));
    },
  };
}

/* ---------- Philips Hue (REST v1; Entertainment API з браузера недоступний) ---------- */

type HueLight = { state: { on?: boolean; bri?: number; xy?: [number, number]; ct?: number; colormode?: string } };

/** sRGB → CIE xy (Wide gamut D65, як у документації Hue). */
function rgbToXy([r, g, b]: RGB): { xy: [number, number]; bri: number } {
  const lin = (v: number) => {
    const c = v / 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.07231 + B * 0.986039;
  const sum = X + Y + Z;
  const xy: [number, number] = sum > 0 ? [+(X / sum).toFixed(4), +(Y / sum).toFixed(4)] : [0.3227, 0.329];
  return { xy, bri: Math.max(1, Math.round(Math.max(r, g, b) / 255 * 254)) };
}

export function hueDriver(c: HueConf): Driver {
  const base = `http://${c.host}/api/${c.user}/lights`;
  let saved: [string, HueLight['state']][] = [];
  let last: RGB | null = null;
  return {
    name: 'Hue',
    // Міст Hue тримає ~10 команд/с на всі лампи — minGap оновлюється після start за кількістю ламп.
    minGap: 250,
    async start() {
      const lights = await ljson<Record<string, HueLight>>(base);
      saved = Object.entries(lights)
        .filter(([, l]) => Array.isArray(l.state?.xy))
        .map(([id, l]) => [id, l.state]);
      if (!saved.length) throw new Error('немає кольорових ламп');
      this.minGap = Math.max(250, 110 * saved.length);
      last = null;
    },
    async send(f) {
      const c = average(f);
      if (!differs(last, c, 8)) return;
      last = c;
      const { xy, bri } = rgbToXy(c);
      await Promise.all(
        saved.map(([id]) => lfetch(`${base}/${id}/state`, jsonBody('PUT', { on: true, xy, bri, transitiontime: 2 }))),
      );
    },
    async stop() {
      await Promise.all(
        saved.map(([id, s]) => {
          const back: Record<string, unknown> = { on: s.on !== false, bri: s.bri, transitiontime: 4 };
          if (s.colormode === 'ct' && s.ct) back.ct = s.ct;
          else if (s.xy) back.xy = s.xy;
          return lfetch(`${base}/${id}/state`, jsonBody('PUT', back)).catch(() => null);
        }),
      );
    },
  };
}

/** Pairing Hue: користувач натискає кнопку на мосту, потім ми просимо ключ. */
export async function huePair(host: string): Promise<string> {
  const r = await ljson<{ success?: { username?: string }; error?: { type?: number; description?: string } }[]>(
    `http://${host}/api`,
    jsonBody('POST', { devicetype: 'hikka_plus#browser' }),
  );
  const user = r[0]?.success?.username;
  if (user) return user;
  if (r[0]?.error?.type === 101) throw new Error('link');
  throw new Error(r[0]?.error?.description ?? 'Hue');
}

/* ---------- Razer Chroma (REST Chroma SDK, Razer Synapse на цьому ж ПК) ---------- */

const RAZER_INIT = ['http://localhost:54235/razer/chromasdk', 'https://chromasdk.io:54236/razer/chromasdk'];
const RAZER_DEVICES = ['keyboard', 'mouse', 'mousepad', 'headset', 'keypad', 'chromalink'] as const;

export function razerDriver(): Driver {
  let uri = '';
  let beat = 0;
  let last: RGB | null = null;
  return {
    name: 'Razer Chroma',
    minGap: 150,
    async start() {
      const app = {
        title: 'Hikka Plus',
        description: 'Підсвітка від відео на hikka.io',
        author: { name: 'M0npet', contact: 'https://github.com/M0npet/hikka-plus' },
        device_supported: RAZER_DEVICES,
        category: 'application',
      };
      let err: unknown;
      for (const url of RAZER_INIT) {
        try {
          const r = await ljson<{ uri?: string }>(url, jsonBody('POST', app));
          if (r.uri) {
            uri = r.uri;
            break;
          }
        } catch (e) {
          err = e;
        }
      }
      if (!uri) throw err ?? new Error('Chroma SDK');
      // Без heartbeat частіше ніж раз на 15 с SDK закриває сесію.
      beat = setInterval(() => void lfetch(`${uri}/heartbeat`, { method: 'PUT' }).catch(() => null), 5000) as unknown as number;
      // SDK потрібна мить після реєстрації, інакше перші ефекти губляться.
      await new Promise((r) => setTimeout(r, 500));
      last = null;
    },
    async send(f) {
      const c = average(f);
      if (!uri || !differs(last, c, 4)) return;
      last = c;
      const color = c[0] | (c[1] << 8) | (c[2] << 16); // BGR
      await Promise.all(
        RAZER_DEVICES.map((d) =>
          lfetch(`${uri}/${d}`, jsonBody('PUT', { effect: 'CHROMA_STATIC', param: { color } })).catch(() => null),
        ),
      );
    },
    async stop() {
      clearInterval(beat);
      if (uri) await lfetch(uri, { method: 'DELETE' }).catch(() => null);
      uri = '';
    },
  };
}
