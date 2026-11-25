import { browser, defineBackground } from '#imports';
import { isAllowedUrl, XHR_HOSTS } from '@/src/core/hosts';
import type { FetchRequest, FetchResponse } from '@/src/core/net';
import type { HikkaRequest } from '@/src/core/hikka-auth';
import { handleHikka } from '@/src/core/hikka-api';
import { hikkaDataOk, tokenItem } from '@/src/core/hikka-auth';
import { onLightsFrame, stopLights, watchLightsConf } from '@/src/lights/engine';
import type { LightsMsg } from '@/src/lights/types';

const TIMEOUT_MS = 20_000;
const MAX_FORM = 32_768;

async function handle(msg: FetchRequest): Promise<FetchResponse> {
  if (!isAllowedUrl(msg.url) || (msg.form?.length ?? 0) > MAX_FORM || (msg.json?.length ?? 0) > MAX_FORM) {
    return { ok: false, status: 0, body: '', error: 'URL не в списку дозволених' };
  }
  const url = new URL(msg.url);
  const headers = new Headers({ Accept: 'application/json, text/html, */*' });
  if (XHR_HOSTS.has(url.host)) headers.set('X-Requested-With', 'XMLHttpRequest');
  const post = msg.method === 'POST';
  if (post)
    headers.set(
      'Content-Type',
      msg.json !== undefined ? 'application/json' : 'application/x-www-form-urlencoded;charset=UTF-8',
    );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: post ? 'POST' : 'GET',
      body: post ? (msg.json ?? msg.form ?? '') : undefined,
      headers,
      credentials: 'omit',
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, body: await res.text(), retryAfter: res.headers.get('retry-after') };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Відбитки кадрів для міток OP/ED (0.5.19–0.5.23, прибрано в 0.6.0) — прибрати зі сховища, щоб не лежали мертвим вантажем. */
async function dropOldFingerprints() {
  try {
    const all = await browser.storage.local.get(null);
    const old = Object.keys(all).filter((k) => k.startsWith('hp:fp:') || k === 'hp:fpIndex');
    if (old.length) await browser.storage.local.remove(old);
  } catch {
    /* немає доступу до сховища — не страшно */
  }
}

/** Згоду на передачу даних у Hikka забрали (about:addons → Дозволи) або її немає після оновлення з 0.6.0 — вийти. */
async function dropTokenWithoutConsent() {
  if (!(await hikkaDataOk()) && (await tokenItem.getValue())) await tokenItem.setValue(null);
}

export default defineBackground(() => {
  void dropOldFingerprints();
  void dropTokenWithoutConsent();
  browser.permissions.onRemoved.addListener(() => void dropTokenWithoutConsent());
  watchLightsConf();
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const msg = raw as FetchRequest | HikkaRequest | LightsMsg;
    if (msg?.type !== 'hp-fetch' && msg?.type !== 'hp-hikka' && msg?.type !== 'hp-lights') return;
    // Приймаємо запити лише від нашого content script на hikka.io.
    const from = sender.url ? new URL(sender.url).host : '';
    const trusted = sender.id === browser.runtime.id && /(^|\.)hikka\.io$/.test(from);
    // Підсвітка пристроїв: кадр або stop, відповіді немає.
    if (msg.type === 'hp-lights') {
      if (trusted) void (msg.stop ? stopLights() : msg.frame && onLightsFrame(msg.frame));
      return;
    }
    if (!trusted) {
      sendResponse({ ok: false, status: 0, body: '', error: 'Заборонене джерело' });
      return;
    }
    if (msg.type === 'hp-hikka') handleHikka(msg).then(sendResponse);
    else handle(msg).then(sendResponse);
    return true; // відповідь асинхронна
  });
});
