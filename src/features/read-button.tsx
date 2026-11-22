import { chapterKey, posText } from '../core/store';
import { IconBook } from '../ui/icons';
import { Button } from '../ui/kit';
import { chapterNo } from '../sources/types';
import { openReader } from './reader-url';
import { continueTarget, overallStatus, titleProgress, useTitleState } from './title-state';

/** Кнопка в лівій колонці під «Додати у список»; прогрес тайтлу — смужка всередині кнопки. */
export function ReadButton() {
  const s = useTitleState();
  if (!s) return null;

  const status = overallStatus(s);
  const target = status === 'ready' ? continueTarget(s) : null;
  const { read, total } = titleProgress(s);
  const started = !!s.progress.last || read > 0;
  const cp = target ? s.progress.chapters[chapterKey(target.number)] : undefined;
  const pos = cp?.pos ?? 0;

  let label = 'Читати';
  let sub: string | null = null;
  if (status === 'loading') sub = 'шукаю розділи…';
  else if (status === 'not-found') sub = 'не знайдено';
  else if (status === 'error') sub = 'помилка';
  else if (target) {
    label = started ? 'Продовжити' : 'Читати';
    sub = `Розділ ${chapterNo(target)}${cp && pos > 0.01 && pos < 0.985 ? ` · ${posText(cp, true)}` : ''}`;
  }

  const pct = status === 'ready' && total > 0 && read > 0 ? Math.min(100, (read / total) * 100) : 0;

  return (
    <div className="hp-col hp-col--tight">
      <Button
        variant="default"
        size="lg"
        className="hp-read"
        disabled={!target}
        title={pct > 0 ? `Прочитано ${read} з ${total}` : undefined}
        onClick={() => target && s.activeId && openReader({ sourceId: s.activeId, chapterId: target.id })}
      >
        <IconBook />
        <span>{label}</span>
        {sub && <span className="hp-read__sub">· {sub}</span>}
        {/* Прогрес тайтлу — тонка смужка по нижньому краю кнопки (як «переглянуто» на картках). */}
        {pct > 0 && (
          <span className="hp-read__bar" role="progressbar" aria-label="Прочитано" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </Button>
    </div>
  );
}
