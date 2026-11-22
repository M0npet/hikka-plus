import { storage } from '#imports';

/**
 * Синхронізація між пристроями (storage.sync) — вмикається у вікні налаштувань.
 * Вимкнено: нічого не читаємо з sync і нічого туди не пишемо, усе лишається на цьому пристрої.
 */
export const syncOnItem = storage.defineItem<boolean>('local:hp:syncOn', { fallback: true });

export const syncOn = () => syncOnItem.getValue().catch(() => true);
