/**
 * Подія content script → скрипт у контексті сторінки (`entrypoints/hikka-bridge.ts`):
 * «запис у списку Hikka для тайтлу <slug> змінився» → оновити кеш самої Hikka.
 */
export const READ_CHANGED_EVENT = 'hikka-plus:read-changed';

export function notifyHikkaReadChanged(slug: string) {
  // detail — рядок: у Firefox об'єкт із content script сторінка прочитати не зможе.
  document.dispatchEvent(new CustomEvent(READ_CHANGED_EVENT, { detail: slug }));
}

/** Те саме для списку перегляду (серії аніме). */
export function notifyHikkaWatchChanged(slug: string) {
  document.dispatchEvent(new CustomEvent(READ_CHANGED_EVENT, { detail: `watch:${slug}` }));
}

/**
 * Подія сторінки → content script: Hikka сама змінила запис у своєму списку (напр. «+/−» у віджеті зліва)
 * — оновити число з Hikka в блоці «Розділи». detail — рядок `read` або `watch`.
 */
export const HIKKA_LIST_EVENT = 'hikka-plus:hikka-list-changed';

/**
 * Лічильник серій із віджета «у списку» самої Hikka (кеш запиту `watchGet` на сторінці) — щоб сітка серій
 * показувала переглянуте без нашого входу з дозволом watchlist. Сторінка → content script: detail `<slug>\n<episodes>`.
 */
export const WATCH_COUNT_EVENT = 'hikka-plus:watch-count';
/** Content script → сторінка: «повідом лічильник для <slug>», detail — slug. */
export const WATCH_COUNT_REQ = 'hikka-plus:watch-count-req';
