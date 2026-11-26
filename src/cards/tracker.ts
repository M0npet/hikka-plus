/*
 * Свій блок у віджеті «Трекер» на головній Hikka (MK 2026-11-26 14:03, ідея 3 з research-hikka-github.md).
 * Hikka сама показує там прогрес і «+ Додати серію»; ми дописуємо те, чого в неї немає:
 *  - аніме: «▶ Продовжити — Серія N · мм:сс» (позиція нашого плеєра), «+N в озвучці» (src/watch/dub-alerts.ts),
 *    «▶ N нових», «Серія N · через X дн.»;
 *  - манґа/ранобе: «Продовжити — Розділ N» (у нашу читалку, #read=…), «▶ N нових розділів».
 *
 * DOM Hikka (hikka-next, features/home/widgets/tracker-widget — лише дивились, код не копіюємо): <div id="tracker">
 * (Block variant=card) → сітка постерів, потім вибраний тайтл — <a href="/anime|manga|novel/<slug>"><h3>…</h3></a>,
 * смужка прогресу, ряд кнопок; усе це — діти одного flex-col. Наш <hikka-plus-tracker> (Shadow DOM, без Preact) —
 * останнім у тому ж flex-col, під кнопками Hikka. Їхній DOM не чіпаємо; без входу віджета немає — і нас теж.
 * Дані й малювання — спільні з віконцем картки (createSpot у popup.ts), нових запитів немає.
 */
import { createSpot, type PopState, type Spot } from './popup';

export const TRACKER_TAG = 'hikka-plus-tracker';

/** Вибраний у трекері тайтл і flex-col, куди ставити наш блок. */
export function findTracker(root: ParentNode = document): Spot | null {
  const box = root.querySelector<HTMLElement>('#tracker');
  if (!box) return null;
  for (const a of box.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!a.querySelector('h3')) continue;
    const m = /^\/(anime|manga|novel)\/([^/?#]+)\/?$/.exec(a.getAttribute('href') ?? '');
    const content = a.parentElement;
    if (m && content && box.contains(content)) return { kind: m[1] as Spot['kind'], slug: m[2]!, content };
  }
  return null;
}

export function createTracker(getState: () => PopState) {
  return createSpot(getState, { tag: TRACKER_TAG, find: () => findTracker(), on: (st) => st.prefs.trk, progress: false, dubs: true });
}
