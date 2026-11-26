import { storage } from '#imports';
import { useEffect, useState } from 'react';

/**
 * Плашки на картках (src/cards/cards.ts). Значення за замовчуванням — увімкнено.
 * on/next — аніме (вкладка «Плеєр»), read — «▶ N нових розділів» на манґі й ранобе (вкладка «Читалка», 0.6.1),
 * pop — свій блок у віконці картки Hikka (src/cards/popup.ts: прогрес, нові, наступна серія, «Продовжити»), аніме й книжки;
 * ua — українські постери аніме (Mikai), манґи й ранобе (прив'язане джерело) — src/cards/covers.ts, вкладка «Hikka».
 */
export type CardsPrefs = { on: boolean; next: boolean; read: boolean; ua: boolean; pop: boolean };
export const DEFAULT_CARDS: CardsPrefs = { on: true, next: true, read: true, ua: true, pop: true };
export const cardsItem = storage.defineItem<CardsPrefs>('local:hp:cards', { fallback: DEFAULT_CARDS });

export function useCardsPrefs(): [CardsPrefs, (p: Partial<CardsPrefs>) => void] {
  const [v, setV] = useState<CardsPrefs>(DEFAULT_CARDS);
  useEffect(() => {
    void cardsItem.getValue().then((x) => setV({ ...DEFAULT_CARDS, ...x }));
    return cardsItem.watch((x) => setV({ ...DEFAULT_CARDS, ...x }));
  }, []);
  return [v, (p) => void cardsItem.getValue().then((x) => cardsItem.setValue({ ...DEFAULT_CARDS, ...x, ...p }))];
}
