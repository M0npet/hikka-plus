/**
 * Запити до API Hikka з токеном користувача. Працює ЛИШЕ в background:
 * токен не передається в content script і не йде нікуди, крім api.hikka.io.
 */
import {
  HIKKA_CLIENT,
  tokenItem,
  type HikkaRead,
  type HikkaRequest,
  type HikkaResponse,
  type HikkaToken,
} from './hikka-auth';

const API = 'https://api.hikka.io';
/** Секрет клієнта — лише в background (у content script не потрапляє). */
const CLIENT_SECRET = (import.meta.env.WXT_HIKKA_CLIENT_SECRET as string | undefined) ?? '';
const TIMEOUT_MS = 20_000;
const SLUG_RE = /^[\w-]{1,200}$/;
const READ_FIELDS = ['status', 'chapters', 'volumes', 'rereads', 'score', 'note', 'start_date', 'end_date'] as const;

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'PUT' | 'POST'; json?: unknown; auth?: boolean } = {},
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
    if (code === 'read:not_found') return { ok: false, error: 'not-found', message: body?.message };
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
  switch (msg.op) {
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
  }
}
