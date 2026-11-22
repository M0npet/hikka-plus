import { browser, defineBackground } from '#imports';
import { isAllowedUrl, XHR_HOSTS } from '@/src/core/hosts';
import type { FetchRequest, FetchResponse } from '@/src/core/net';
import type { HikkaRequest } from '@/src/core/hikka-auth';
import { handleHikka } from '@/src/core/hikka-api';

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
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const msg = raw as FetchRequest | HikkaRequest;
    if (msg?.type !== 'hp-fetch' && msg?.type !== 'hp-hikka') return;
    // Приймаємо запити лише від нашого content script на hikka.io.
    const from = sender.url ? new URL(sender.url).host : '';
    if (sender.id !== browser.runtime.id || !/(^|\.)hikka\.io$/.test(from)) {
      sendResponse({ ok: false, status: 0, body: '', error: 'Заборонене джерело' });
      return;
    }
    if (msg.type === 'hp-hikka') handleHikka(msg).then(sendResponse);
    else handle(msg).then(sendResponse);
    return true; // відповідь асинхронна
  });
});
