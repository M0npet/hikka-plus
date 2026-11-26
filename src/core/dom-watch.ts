/**
 * Один MutationObserver на document.body (childList, subtree) для всього content script на hikka.io (бэклог 2b, 2026-11-26):
 * раніше Mounter, плашки карток і стеження за адресою SPA мали кожен свій — браузер тричі збирав ті самі записи
 * на кожну зміну DOM Hikka. Підписники отримують ті самі записи; останній відписався — спостерігач вимикається.
 */
type Sub = (recs: MutationRecord[]) => void;

const subs = new Set<Sub>();
let obs: MutationObserver | null = null;

export function onBodyMutations(cb: Sub): () => void {
  subs.add(cb);
  if (!obs) {
    obs = new MutationObserver((recs) => subs.forEach((f) => f(recs)));
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
