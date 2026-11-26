/*
 * Фон: спільне число на іконці (нові серії в озвучках + нові розділи) і доступ до API сповіщень.
 * Сповіщення — необов'язковий дозвіл notifications; API з'являється лише після нього.
 */
import { browser } from '#imports';
import { dubNewTotal, dubPrefsItem, dubsItem, getDubPrefs } from '../watch/dub-alerts';
import { chapNewTotal, chapPrefsItem, chapsItem, getChapPrefs } from '../features/chapter-alerts';

type ActionApi = { setBadgeText(d: { text: string }): unknown; setBadgeBackgroundColor(d: { color: string }): unknown };
/** MV3 — action, MV2 (Firefox) — browserAction. */
const actionApi = (): ActionApi | undefined =>
  (browser as unknown as { action?: ActionApi; browserAction?: ActionApi }).action ??
  (browser as unknown as { browserAction?: ActionApi }).browserAction;

export type NotesApi = {
  create(id: string, o: { type: 'basic'; iconUrl: string; title: string; message: string }): Promise<string>;
  onClicked: { addListener(f: (id: string) => void): void; hasListener(f: (id: string) => void): boolean };
};
export const notesApi = () => (browser as unknown as { notifications?: NotesApi }).notifications;

/** Підписатися на клік по сповіщенню, коли дозвіл уже є (і після того, як його дали). */
export function hookNotes(onClick: (id: string) => void) {
  const hook = () => {
    const api = notesApi();
    if (api && !api.onClicked.hasListener(onClick)) api.onClicked.addListener(onClick);
  };
  hook();
  browser.permissions.onAdded?.addListener(hook);
}

export async function updateBadge() {
  const api = actionApi();
  if (!api) return;
  const [dp, cp, dubs, chaps] = await Promise.all([getDubPrefs(), getChapPrefs(), dubsItem.getValue(), chapsItem.getValue()]);
  const n = (dp.on && dp.badge ? dubNewTotal(dubs) : 0) + (cp.on && cp.badge ? chapNewTotal(chaps) : 0);
  try {
    await api.setBadgeBackgroundColor({ color: '#d93b8c' });
    await api.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
  } catch {
    /* немає іконки (Android) — не страшно */
  }
}

export function watchBadge() {
  for (const item of [dubsItem, dubPrefsItem, chapsItem, chapPrefsItem] as const) (item.watch as (f: () => void) => void)(() => void updateBadge());
  void updateBadge();
}
