import { chapterKey } from '../core/store';
import { IconBook } from '../ui/icons';
import { openReader } from './reader-url';
import { continueTarget, overallStatus, titleProgress, useTitleState } from './title-state';

/** Кнопка в лівій колонці під «Додати у список» + смужка прогресу тайтлу. */
export function ReadButton() {
  const s = useTitleState();
  if (!s) return null;

  const status = overallStatus(s);
  const target = status === 'ready' ? continueTarget(s) : null;
  const { read, total } = titleProgress(s);
  const started = !!s.progress.last || read > 0;
  const pos = target ? (s.progress.chapters[chapterKey(target.number)]?.pos ?? 0) : 0;

  let label = 'Читати';
  let sub: string | null = null;
  if (status === 'loading') sub = 'шукаю розділи…';
  else if (status === 'not-found') sub = 'не знайдено';
  else if (status === 'error') sub = 'помилка';
  else if (target) {
    label = started ? 'Продовжити' : 'Читати';
    sub = `Розділ ${target.number}${pos > 0.01 && pos < 0.985 ? ` · ${Math.round(pos * 100)}%` : ''}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        className="hp-btn hp-btn--lg hp-btn--primary hp-read"
        disabled={!target}
        onClick={() => target && s.activeId && openReader({ sourceId: s.activeId, chapterId: target.id })}
      >
        <IconBook />
        <span>{label}</span>
        {sub && <span className="hp-read__sub">· {sub}</span>}
      </button>
      {status === 'ready' && total > 0 && read > 0 && (
        <div title={`Прочитано ${read} з ${total}`}>
          <div className="hp-progress">
            <div style={{ width: `${Math.round((read / total) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
