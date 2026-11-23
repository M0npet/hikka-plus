import { storage } from '#imports';
import { useEffect, useState } from 'react';

/** Плашки на картках аніме (src/cards/cards.ts). Значення за замовчуванням — увімкнено. */
export type CardsPrefs = { on: boolean; next: boolean };
export const DEFAULT_CARDS: CardsPrefs = { on: true, next: true };
export const cardsItem = storage.defineItem<CardsPrefs>('local:hp:cards', { fallback: DEFAULT_CARDS });

export function useCardsPrefs(): [CardsPrefs, (p: Partial<CardsPrefs>) => void] {
  const [v, setV] = useState<CardsPrefs>(DEFAULT_CARDS);
  useEffect(() => {
    void cardsItem.getValue().then((x) => setV({ ...DEFAULT_CARDS, ...x }));
    return cardsItem.watch((x) => setV({ ...DEFAULT_CARDS, ...x }));
  }, []);
  return [v, (p) => void cardsItem.getValue().then((x) => cardsItem.setValue({ ...DEFAULT_CARDS, ...x, ...p }))];
}
