/**
 * Запити до API Hikka з токеном користувача. Працює ЛИШЕ в background:
 * токен не передається в content script і не йде нікуди, крім api.hikka.io.
 */
import { browser } from '#imports';
import {
  HIKKA_CLIENT,
  hikkaDataOk,
  tokenItem,
  type HikkaRead,
  type HikkaRequest,
  type HikkaResponse,
  type HikkaToken,
  type HikkaWatch,
} from './hikka-auth';

const API = 'https://api.hikka.io';
/** Секрет клієнта — лише в background (у content script не потрапляє). */
const CLIENT_SECRET = (import.meta.env.WXT_HIKKA_CLIENT_SECRET as string | undefined) ?? '';
const TIMEOUT_MS = 20_000;
const SLUG_RE = /^[\w-]{1,200}$/;
const READ_FIELDS = ['status', 'chapters', 'volumes', 'rereads', 'score', 'note', 'start_date', 'end_date'] as const;

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'PUT' | 'POST'; json?: unknown; auth?: boolean; scoped?: boolean } = {},
): Promise<HikkaResponse<T>> {
  const headers = new Headers({ Accept: 'application/json' });
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.auth !== false) {
    const token = await tokenItem.getValue();
    if (!token) return { ok: false, error: 'auth', message: 'Не виконано вхід у Hikka' };
    headers.set('auth', token.secret);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + path, {
      method: init.method ?? 'GET',
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      credentials: 'omit',
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as (T & { code?: string; message?: string }) | null;
    if (res.ok) return { ok: true, data: body as T };
    const code = body?.code ?? '';
    if (code === 'read:not_found' || code === 'watch:not_found') return { ok: false, error: 'not-found', message: body?.message };
    // Запит, для якого в токена може не бути дозволу (список перегляду): вхід не скидаємо.
    if (init.scoped && (code === 'permission:denied' || code.startsWith('auth:scope') || res.status === 403)) {
      return { ok: false, error: 'scope', message: body?.message ?? `HTTP ${res.status}` };
    }
    if (code.startsWith('auth:') || res.status === 401 || code === 'permission:denied') {
      // Токен прострочений/відкликаний або без потрібних дозволів — виходимо.
      if (init.auth !== false) await tokenItem.setValue(null);
      return { ok: false, error: 'auth', message: body?.message ?? `HTTP ${res.status}` };
    }
    return { ok: false, error: 'other', message: body?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: 'network', message: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const WATCH_STATUS = new Set(['completed', 'watching', 'on_hold', 'dropped', 'planned']);

function pickWatch(r: Partial<HikkaWatch> | undefined): HikkaWatch {
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
  return {
    status: WATCH_STATUS.has(r?.status as string) ? (r!.status as HikkaWatch['status']) : 'watching',
    episodes: n(r?.episodes, 10000),
    rewatches: n(r?.rewatches, 100),
    score: n(r?.score, 10),
    note: typeof r?.note === 'string' ? r.note : null,
    start_date: typeof r?.start_date === 'number' ? r.start_date : null,
    end_date: typeof r?.end_date === 'number' ? r.end_date : null,
  };
}

function pickRead(r: Partial<HikkaRead> | undefined): HikkaRead {
  const out: Record<string, unknown> = {};
  for (const k of READ_FIELDS) out[k] = r?.[k] ?? null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return {
    status: (out.status as HikkaRead['status']) ?? 'reading',
    chapters: Math.min(n(out.chapters), 10000),
    volumes: Math.min(n(out.volumes), 10000),
    rereads: Math.min(n(out.rereads), 100),
    score: Math.min(n(out.score), 10),
    note: typeof out.note === 'string' ? out.note : null,
    start_date: typeof out.start_date === 'number' ? out.start_date : null,
    end_date: typeof out.end_date === 'number' ? out.end_date : null,
  };
}

export async function handleHikka(msg: HikkaRequest): Promise<HikkaResponse> {
  // Без згоди Firefox на передачу даних (необов'язкова з 0.6.1) — нічого в Hikka не шлемо, токен не тримаємо.
  if (msg.op !== 'logout' && !(await hikkaDataOk())) {
    if (msg.op === 'consent') {
      if (msg.open) await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#hikka` });
      return { ok: true, data: false };
    }
    if (await tokenItem.getValue()) await tokenItem.setValue(null);
    return { ok: false, error: 'auth', message: 'Немає дозволу Firefox на передачу даних у Hikka — увійдіть ще раз' };
  }
  switch (msg.op) {
    case 'consent':
      return { ok: true, data: true };
    case 'exchange': {
      if (!HIKKA_CLIENT.reference || !CLIENT_SECRET) {
        return { ok: false, error: 'other', message: 'Клієнт Hikka не налаштований у цій збірці' };
      }
      if (!/^[\w-]{8,64}$/.test(msg.reference)) return { ok: false, error: 'other', message: 'Неправильний reference' };
      const r = await request<HikkaToken>('/auth/token', {
        method: 'POST',
        auth: false,
        json: { request_reference: msg.reference, client_secret: CLIENT_SECRET },
      });
      if (!r.ok || !r.data?.secret) return { ...r, ok: false };
      await tokenItem.setValue({ secret: r.data.secret, expiration: r.data.expiration });
      // Новий токен живе 30 хв; будь-який запит із перевіркою дозволів
      // продовжує його до 30 днів (далі — при кожному використанні).
      await request('/read/manga/hikka-plus-ping');
      return { ok: true };
    }
    case 'logout':
      await tokenItem.setValue(null);
      return { ok: true };
    case 'getRead':
    case 'putRead': {
      if (msg.kind !== 'manga' && msg.kind !== 'novel') return { ok: false, error: 'other' };
      if (!SLUG_RE.test(msg.slug)) return { ok: false, error: 'other' };
      const path = `/read/${msg.kind}/${msg.slug}`;
      if (msg.op === 'getRead') {
        const r = await request<HikkaRead>(path);
        return r.ok ? { ok: true, data: pickRead(r.data) } : r;
      }
      const r = await request<HikkaRead>(path, { method: 'PUT', json: pickRead(msg.read) });
      return r.ok ? { ok: true, data: pickRead(r.data) } : r;
    }
    case 'getWatch':
    case 'putWatch': {
      if (!SLUG_RE.test(msg.slug)) return { ok: false, error: 'other' };
      const path = `/watch/${msg.slug}`;
      const r =
        msg.op === 'getWatch'
          ? await request<HikkaWatch>(path, { scoped: true })
          : await request<HikkaWatch>(path, { method: 'PUT', json: pickWatch(msg.watch), scoped: true });
      return r.ok ? { ok: true, data: pickWatch(r.data) } : r;
    }
  }
}
