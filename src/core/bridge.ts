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

/**
 * Те саме для читання (MK 15:57: «18/? розділів» у віджеті Hikka, а в блоці 0 — без нашого входу числа не було):
 * кеш запиту `readGet` на сторінці → content script, detail `<content_type>\n<slug>\n<chapters>`.
 */
export const READ_COUNT_EVENT = 'hikka-plus:read-count';
/** Content script → сторінка: «повідом кількість розділів для <slug>», detail — slug. */
export const READ_COUNT_REQ = 'hikka-plus:read-count-req';

/**
 * Плашки на картках аніме (src/cards/): що знає кеш самої Hikka про тайтли на сторінці — каталог (`searchAnime`),
 * «Мої списки» (`userWatchList`, лише власний список), календар (`animeSchedule`), віджет `watchGet`.
 * Сторінка → content script: detail — JSON `[[slug, episodes_released, episodes_total, status, watched, watch_status], …]`
 * (watched = -1 і watch_status = '' — запис у списку невідомий). Без жодного запиту до API.
 */
export const CARDS_EVENT = 'hikka-plus:cards';
/** Content script → сторінка: «надішли знімок карток». */
export const CARDS_REQ = 'hikka-plus:cards-req';
export type CardRow = [slug: string, released: number, total: number, status: string, watched: number, watchStatus: string];

/** content script → сторінка: SPA-перехід Hikka на шлях (може бути з #read=…) — «Продовжити» у віконці картки (src/cards/popup.ts). */
export const NAV_EVENT = 'hikka-plus:nav';

/**
 * Мова назв користувача Hikka (src/core/title-lang.ts): кеш `profileUi` (GET /user/me/ui, лише після входу) →
 * content script, detail — `preferences.title_language` (`title_ua` / `title_en` / `title_ja` / `title_original`).
 */
export const TITLE_LANG_EVENT = 'hikka-plus:title-lang';
/** Content script → сторінка: «повідом мову назв» (і заодно ім'я, ME_EVENT). */
export const TITLE_LANG_REQ = 'hikka-plus:title-lang-req';
/** Ім'я того, хто зайшов на Hikka (кеш `profile`) → content script, detail — username. Для «Далі з Дивлюсь» (src/watch/up-next.ts). */
export const ME_EVENT = 'hikka-plus:me';
