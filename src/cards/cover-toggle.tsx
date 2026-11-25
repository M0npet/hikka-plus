import { Button } from '../ui/kit';
import { IconImage } from '../ui/icons';
import { COVER_SOURCE_NAMES, setCoverOriginal, useCover, type CoverKind } from './covers';
import { useCardsPrefs } from './prefs';

/**
 * Кнопка-іконка в шапці блоку «Розділи» / «Перегляд»: український постер ↔ оригінальний постер Hikka для цього тайтлу
 * (src/cards/covers.ts). Немає українського постера або вимкнено загалом — кнопки немає.
 */
export function CoverToggle({ kind, slug }: { kind: CoverKind; slug: string }) {
  const [prefs] = useCardsPrefs();
  const cover = useCover(kind, slug);
  if (!prefs.ua || !cover) return null;
  const original = !!cover.o;
  const from = COVER_SOURCE_NAMES[cover.s] ?? cover.s;
  const by = cover.a ? `${cover.a}, ${from}` : from;
  return (
    <Button
      variant="ghost"
      size="sm"
      icon
      aria-pressed={!original}
      aria-label={original ? 'Показати український постер' : 'Показати оригінальний постер Hikka'}
      title={original ? `Показати український постер (${by})` : `Український постер (${by}) — показати оригінальний постер Hikka`}
      onClick={() => void setCoverOriginal(kind, slug, !original)}
    >
      <IconImage />
    </Button>
  );
}
