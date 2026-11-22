import { browser, defineBackground } from '#imports';
import { isAllowedUrl } from '@/src/core/hosts';
import type { FetchRequest, FetchResponse } from '@/src/core/net';

const TIMEOUT_MS = 20_000;

async function handle(msg: FetchRequest): Promise<FetchResponse> {
  if (!isAllowedUrl(msg.url)) {
    return { ok: false, status: 0, body: '', error: 'URL не в списку дозволених' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(msg.url, {
      credentials: 'omit',
      signal: ctrl.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
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
    const msg = raw as FetchRequest;
    if (msg?.type !== 'hp-fetch') return;
    // Приймаємо запити лише від нашого content script на hikka.io.
    const from = sender.url ? new URL(sender.url).host : '';
    if (sender.id !== browser.runtime.id || !/(^|\.)hikka\.io$/.test(from)) {
      sendResponse({ ok: false, status: 0, body: '', error: 'Заборонене джерело' });
      return;
    }
    handle(msg).then(sendResponse);
    return true; // відповідь асинхронна
  });
});
