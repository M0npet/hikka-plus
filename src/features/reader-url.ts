import { readerStore, titleStore, type ReaderRequest } from './title-state';

/**
 * Відкритий розділ пишемо в адресу: hikka.io/novel/<slug>#read=<джерело>:<id розділу>.
 * Тож посилання на розділ працює, після оновлення сторінки читалка відкривається знову,
 * а кнопка «Назад» у браузері закриває читалку замість переходу з тайтлу.
 */
const PREFIX = '#read=';

let pushed = false; // чи додали ми запис в історію при відкритті
let pending: ReaderRequest | null = null; // запит з адреси, що чекає на завантаження розділів

const base = () => location.pathname + location.search;
const hashOf = (r: ReaderRequest) => PREFIX + encodeURIComponent(`${r.sourceId}:${r.chapterId}`);

export function parseHash(hash = location.hash): ReaderRequest | null {
  if (!hash.startsWith(PREFIX)) return null;
  const v = decodeURIComponent(hash.slice(PREFIX.length));
  const i = v.indexOf(':');
  return i > 0 ? { sourceId: v.slice(0, i), chapterId: v.slice(i + 1) } : null;
}

export function openReader(r: ReaderRequest) {
  readerStore.set(r);
  if (location.hash.startsWith(PREFIX)) {
    history.replaceState(history.state, '', base() + hashOf(r));
  } else {
    history.pushState(history.state, '', base() + hashOf(r));
    pushed = true;
  }
}

/** Перехід на інший розділ усередині читалки (без нового запису в історії). */
export function moveReader(r: ReaderRequest) {
  readerStore.set(r);
  history.replaceState(history.state, '', base() + hashOf(r));
}

export function closeReader() {
  if (!readerStore.get()) return;
  readerStore.set(null);
  if (pushed) {
    pushed = false;
    history.back();
  } else if (location.hash.startsWith(PREFIX)) {
    history.replaceState(history.state, '', base());
  }
}

function tryOpenPending() {
  const s = titleStore.get();
  if (!pending || !s) return;
  const src = s.sources[pending.sourceId];
  if (!src || src.status === 'searching' || src.status === 'loading') return;
  if (src.status === 'ready' && src.chapters.some((c) => c.id === pending!.chapterId)) {
    readerStore.set(pending);
  }
  pending = null;
}

export function initReaderUrl(addListener: (cb: () => void) => void) {
  pending = parseHash();
  titleStore.subscribe(tryOpenPending);
  addListener(() => {
    const r = parseHash();
    if (!r) {
      pushed = false;
      if (readerStore.get()) readerStore.set(null);
    } else if (r.chapterId !== readerStore.get()?.chapterId) {
      pending = r;
      tryOpenPending();
    }
  });
}
