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
