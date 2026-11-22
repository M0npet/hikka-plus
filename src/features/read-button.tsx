import { chapterLabel } from '../sources/types';
import { IconBook } from '../ui/icons';
import { continueTarget, openReader, useTitleState } from './title-state';

/** Кнопка в лівій колонці під «Додати у список». */
export function ReadButton() {
  const s = useTitleState();
  if (!s) return null;

  const target = s.status === 'ready' ? continueTarget(s) : null;
  const isContinue = !!target && (target.resume || target.chapter.id !== s.chapters[0]?.id);

  let label = 'Читати';
  let sub: string | null = null;
  if (s.status === 'loading') sub = 'шукаю розділи…';
  else if (s.status === 'not-found') sub = 'не знайдено на джерелах';
  else if (s.status === 'error') sub = 'помилка завантаження';
  else if (target) {
    label = isContinue ? 'Продовжити' : 'Читати';
    sub = chapterLabel({ ...target.chapter, name: undefined });
  }

  return (
    <button
      type="button"
      className="hp-btn hp-btn--lg hp-btn--primary hp-read"
      disabled={!target}
      title={s.source ? `Джерело: ${s.source.name}` : undefined}
      onClick={() => target && openReader(target.chapter.id, target.resume)}
    >
      <IconBook />
      <span>{label}</span>
      {sub && <span className="hp-read__sub">· {sub}</span>}
    </button>
  );
}
