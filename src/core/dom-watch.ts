/**
 * Один MutationObserver на document.body (childList, subtree) для всього content script на hikka.io (бэклог 2b, 2026-11-26):
 * раніше Mounter, плашки карток і стеження за адресою SPA мали кожен свій — браузер тричі збирав ті самі записи
 * на кожну зміну DOM Hikka. Підписники отримують ті самі записи; останній відписався — спостерігач вимикається.
 * Пачка, де додано/прибрано лише текстові вузли (таймери, «N хв тому», лічильники), будить лише тих, хто попросив
 * `{ text: true }` (звірка адреси SPA: перехід між схожими тайтлами React може зробити самими текстовими вузлами).
 * Mounter, плашкам, віконцю картки й трекеру потрібні лише елементи (замір 2026-11-27, каталог 160 карток).
 */
type Sub = (recs: MutationRecord[]) => void;

const subs = new Map<Sub, boolean>();
let obs: MutationObserver | null = null;

const hasElement = (l: NodeList) => {
  for (const n of l) if (n.nodeType === 1) return true;
  return false;
};

export function onBodyMutations(cb: Sub, opts?: { text?: boolean }): () => void {
  subs.set(cb, !!opts?.text);
  if (!obs) {
    obs = new MutationObserver((recs) => {
      const el = recs.some((r) => hasElement(r.addedNodes) || hasElement(r.removedNodes));
      subs.forEach((text, f) => (el || text) && f(recs));
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  return () => {
    subs.delete(cb);
    if (!subs.size) {
      obs?.disconnect();
      obs = null;
    }
  };
}
