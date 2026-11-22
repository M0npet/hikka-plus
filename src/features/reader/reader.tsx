import { useCallback, useEffect, useRef, useState } from 'react';
import { chapterKey, getProgress, updateProgress, useSettings } from '../../core/store';
import { getSource } from '../../sources/registry';
import { chapterLabel, type Chapter, type ChapterContent, type ContentFormat } from '../../sources/types';
import { IconCheck, IconClose, IconExpand, IconExternal, IconLeft, IconList, IconRight, IconSettings } from '../../ui/icons';
import { closeReader, moveReader } from '../reader-url';
import { contentFormat, neighbor, titleProgress, useReaderRequest, useTitleState } from '../title-state';
import { SettingsPanel } from './settings-panel';
import { Button, btn, Progress } from '../../ui/kit';
import { NovelView, PagedView, StripView } from './views';

type Load =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; content: ChapterContent };

const SAVE_DELAY = 600;
/** Позиція, з якої вважаємо розділ дочитаним. */
const DONE_AT = 0.985;

export function Reader() {
  const s = useTitleState();
  const req = useReaderRequest();
  const settings = useSettings();

  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [panel, setPanel] = useState<'none' | 'chapters' | 'settings'>('none');
  const [barsHidden, setBarsHidden] = useState(false);
  const [page, setPage] = useState(0);
  const [pos, setPos] = useState(0); // прогрес поточного розділу 0..1
  const [pageInfo, setPageInfo] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastTop = useRef(0);

  const sourceId = req?.sourceId ?? '';
  const source = getSource(sourceId);
  const srcState = s?.sources[sourceId];
  const team = s?.teams[sourceId] ?? '';
  const all = srcState?.chapters ?? [];
  const list = team ? all.filter((c) => c.team === team) : all;
  const chapter: Chapter | undefined = all.find((c) => c.id === req?.chapterId);
  const prev = chapter ? neighbor(list.length ? list : all, chapter, -1) : undefined;
  const next = chapter ? neighbor(list.length ? list : all, chapter, 1) : undefined;

  const format: ContentFormat =
    load.status === 'ready' && load.content.type === 'text' ? 'novel' : s ? contentFormat(s) : 'manga';
  const isNovel = format === 'novel';
  const paged = !isNovel && (format === 'manga' ? settings.manga.modeManga : settings.manga.modeWebtoon) === 'paged';
  const pageCount = load.status === 'ready' && load.content.type === 'images' ? load.content.pages.length : 0;

  // Блокуємо прокрутку сторінки під оверлеєм.
  useEffect(() => {
    const el = document.documentElement;
    const prevOverflow = el.style.overflow;
    el.style.overflow = 'hidden';
    scrollRef.current?.focus({ preventScroll: true });
    return () => {
      el.style.overflow = prevOverflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  /** Зберегти позицію в розділі (і «прочитано», якщо дочитали). */
  const save = useCallback(
    (p: number, forceRead = false) => {
      if (!s || !chapter || !source) return;
      const key = chapterKey(chapter.number);
      const done = forceRead || p >= DONE_AT;
      void updateProgress(s.page.kind, s.page.slug, (pr) => {
        const prevCh = pr.chapters[key];
        return {
          ...pr,
          last: { key, label: chapterLabel(chapter), sourceId: source.id, chapterId: chapter.id },
          chapters: {
            ...pr.chapters,
            [key]: { pos: Math.max(0, Math.min(1, p)), read: done || !!prevCh?.read, at: Date.now() },
          },
        };
      });
    },
    [s, chapter, source],
  );

  // Завантаження розділу.
  useEffect(() => {
    if (!s || !source || !chapter) return;
    let alive = true;
    setLoad({ status: 'loading' });
    setPos(0);
    setPageInfo('');
    finishedRef.current = false;
    scrollRef.current?.scrollTo({ top: 0 });

    (async () => {
      // Відновлюємо місце, якщо розділ почали, але не дочитали.
      const pr = await getProgress(s.page.kind, s.page.slug);
      const cp = pr.chapters[chapterKey(chapter.number)];
      restoreRef.current = cp && !cp.read && cp.pos > 0.01 && cp.pos < DONE_AT ? cp.pos : null;
      try {
        const content = await source.getContent(chapter);
        if (!alive) return;
        const r = restoreRef.current;
        if (content.type === 'images') {
          const p = r != null ? Math.round(r * Math.max(0, content.pages.length - 1)) : 0;
          setPage(p);
        }
        setPos(r ?? 0);
        setLoad({ status: 'ready', content });
        save(r ?? 0);
      } catch (e) {
        if (alive) setLoad({ status: 'error', error: String(e instanceof Error ? e.message : e) });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, source?.id]);

  // Відновлення позиції прокрутки (картинки догружаються — пробуємо кілька разів).
  useEffect(() => {
    if (load.status !== 'ready' || paged) return;
    const ratio = restoreRef.current;
    const el = scrollRef.current;
    if (ratio == null || !el) return;
    let userMoved = false;
    const mark = () => (userMoved = true);
    el.addEventListener('wheel', mark, { once: true });
    el.addEventListener('touchstart', mark, { once: true });
    el.addEventListener('keydown', mark, { once: true });
    const apply = () => {
      if (!userMoved) el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    };
    const timers = [50, 400, 1200, 2500].map((t) => window.setTimeout(apply, t));
    return () => {
      timers.forEach(clearTimeout);
      el.removeEventListener('wheel', mark);
      el.removeEventListener('touchstart', mark);
      el.removeEventListener('keydown', mark);
    };
  }, [load, paged]);

  const goChapter = useCallback(
    (c?: Chapter) => {
      if (!c) return;
      restoreRef.current = null;
      setPanel('none');
      moveReader({ sourceId, chapterId: c.id });
    },
    [sourceId],
  );

  const setPageAndSave = useCallback(
    (p: number) => {
      setPage(p);
      const ratio = pageCount > 1 ? p / (pageCount - 1) : 1;
      setPos(ratio);
      save(ratio, p >= pageCount - 1);
    },
    [pageCount, save],
  );

  const goPage = useCallback(
    (dir: -1 | 1) => {
      if (dir === 1) {
        if (page + 1 < pageCount) setPageAndSave(page + 1);
        else goChapter(next);
      } else if (page > 0) setPageAndSave(page - 1);
      else goChapter(prev);
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [page, pageCount, next, prev, goChapter, setPageAndSave],
  );

  // Прокрутка: ховаємо панелі, зберігаємо позицію, відмічаємо прочитане.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || paged || load.status !== 'ready') return;
    const top = el.scrollTop;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, top / max);
    setPos(ratio);

    if (settings.autoHideBars && panel === 'none') {
      if (top - lastTop.current > 12 && top > 80) setBarsHidden(true);
      else if (lastTop.current - top > 12) setBarsHidden(false);
    }
    lastTop.current = top;

    if (!isNovel && settings.manga.pageNumbers) {
      const imgs = el.querySelectorAll<HTMLImageElement>('img[data-page]');
      const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
      let cur = 0;
      for (const img of imgs) if (img.getBoundingClientRect().top <= mid) cur = Number(img.dataset.page);
      setPageInfo(`${cur + 1} / ${imgs.length}`);
    }

    if ((ratio >= DONE_AT || max - top < 40) && !finishedRef.current) {
      finishedRef.current = true;
      save(1, true);
      return;
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(ratio), SAVE_DELAY);
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  // Клавіатура: перехоплюємо лише поки відкрита наша читалка і не передаємо далі
  // (щоб не спрацьовували гарячі клавіші сайту чи інших розширень).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      const typing = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      switch (e.key) {
        case 'Escape':
          if (panel !== 'none') setPanel('none');
          else if (!document.fullscreenElement) closeReader();
          else handled = false;
          break;
        case 'ArrowRight':
        case 'ArrowLeft': {
          if (typing) return;
          let dir: -1 | 1 = e.key === 'ArrowRight' ? 1 : -1;
          if (paged) {
            if (settings.manga.rtl) dir = (dir * -1) as -1 | 1;
            goPage(dir);
          } else goChapter(dir === 1 ? next : prev);
          break;
        }
        case 'f':
        case 'F':
        case 'а':
        case 'А':
          if (typing) return;
          toggleFullscreen();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel, paged, settings.manga.rtl, goPage, goChapter, next, prev, toggleFullscreen]);

  if (!s || !req) return null;

  const themeCls = isNovel && settings.novel.theme !== 'site' ? `hp-theme-${settings.novel.theme}` : '';
  const title = s.hikka?.title_ua || s.hikka?.title_en || srcState?.remote?.title || '';
  const label = chapter ? chapterLabel(chapter) : '';
  const idx = chapter ? [...new Set(list.map((c) => chapterKey(c.number)))].indexOf(chapterKey(chapter.number)) : -1;
  const total = new Set(list.map((c) => chapterKey(c.number))).size;

  return (
    <div
      ref={rootRef}
      className={`hp-reader ${themeCls} ${barsHidden ? 'hp-bars-hidden' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Читалка: ${title}`}
    >
      {/* Прогрес розділу — видно завжди, навіть коли панелі сховані */}
      <div className="hp-chbar" aria-hidden="true">
        <div style={{ width: `${Math.round(pos * 100)}%` }} />
      </div>

      {/* Верхня панель */}
      <header className="hp-bar hp-bar--top">
        <Button variant="ghost" size="md" icon title="Закрити (Esc)" aria-label="Закрити" onClick={closeReader}>
          <IconClose />
        </Button>
        <div className="hp-bar__title hp-grow">
          <b className="hp-ellipsis">{title}</b>
          <span className="hp-ellipsis">
            {label}
            {chapter?.team ? ` · ${chapter.team}` : ''}
            {source ? ` · ${source.name}` : ''}
          </span>
        </div>
        <span className="hp-small hp-muted hp-tnum hp-bar__pct">{Math.round(pos * 100)}%</span>
        {chapter && (
          <a
            className={btn('ghost', 'md', true)}
            href={chapter.url}
            target="_blank"
            rel="noreferrer"
            title={`Відкрити на ${source?.name}`}
          >
            <IconExternal />
          </a>
        )}
        <Button variant="ghost" size="md" icon title="Повний екран (F)" aria-label="Повний екран" onClick={toggleFullscreen}>
          <IconExpand />
        </Button>
      </header>

      {/* Вміст */}
      <div
        ref={scrollRef}
        className="hp-reader__scroll"
        tabIndex={-1}
        onScroll={onScroll}
        onClick={(e) => {
          if (paged || (e.target as HTMLElement).closest('a,button')) return;
          if (panel !== 'none') setPanel('none');
          else if (!window.getSelection()?.toString()) setBarsHidden((v) => !v);
        }}
      >
        {!chapter && <div className="hp-error">Розділ не знайдено у списку джерела.</div>}
        {chapter && load.status === 'loading' && (
          <div className="hp-error">
            <span className="hp-spinner" aria-hidden="true" />
            Завантаження…
          </div>
        )}
        {chapter && load.status === 'error' && (
          <div className="hp-error">
            <div>{load.error}</div>
            <a className={btn('secondary', 'md')} href={chapter.url} target="_blank" rel="noreferrer">
              Відкрити на {source?.name}
            </a>
          </div>
        )}
        {load.status === 'ready' && load.content.type === 'text' && (
          <NovelView html={load.content.html} title={label} s={settings.novel} />
        )}
        {load.status === 'ready' && load.content.type === 'images' && !paged && (
          <StripView content={load.content} s={settings.manga} />
        )}
        {load.status === 'ready' && load.content.type === 'images' && paged && (
          <PagedView
            content={load.content}
            page={page}
            s={settings.manga}
            onZone={(d) => (d === 0 ? setBarsHidden((v) => !v) : goPage(d))}
          />
        )}
        {load.status === 'ready' && !paged && (
          <div className="hp-end">
            <div className="hp-muted hp-small">Кінець розділу{chapter?.team ? ` · переклад: ${chapter.team}` : ''}</div>
            {next ? (
              <Button variant="default" size="lg" onClick={() => goChapter(next)}>
                Далі: {chapterLabel(next)}
                <IconRight />
              </Button>
            ) : (
              <div className="hp-small">Це останній доступний розділ.</div>
            )}
            <Button variant="ghost" size="md" onClick={closeReader}>
              До сторінки тайтлу
            </Button>
          </div>
        )}
      </div>

      {paged && settings.manga.pageNumbers && pageCount > 0 && (
        <div className="hp-pagenum">
          {page + 1} / {pageCount}
        </div>
      )}
      {!paged && !isNovel && settings.manga.pageNumbers && pageInfo && <div className="hp-pagenum">{pageInfo}</div>}

      {/* Нижня панель */}
      <nav className="hp-bar hp-bar--bottom" aria-label="Навігація по розділах">
        <Button
          variant="ghost"
          size="md"
          icon
          disabled={!prev}
          title={prev ? `Попередній: ${chapterLabel(prev)}` : 'Немає попереднього'}
          aria-label="Попередній розділ"
          onClick={() => goChapter(prev)}
        >
          <IconLeft />
        </Button>
        <Button
          variant="ghost"
          size="md"
          icon
          aria-pressed={panel === 'chapters'}
          title="Усі розділи"
          aria-label="Усі розділи"
          onClick={() => setPanel(panel === 'chapters' ? 'none' : 'chapters')}
        >
          <IconList />
        </Button>
        <span className="hp-small hp-muted hp-tnum hp-bar__count">
          {idx + 1} / {total}
        </span>
        <Button
          variant="ghost"
          size="md"
          icon
          aria-pressed={panel === 'settings'}
          title="Налаштування"
          aria-label="Налаштування"
          onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
        >
          <IconSettings />
        </Button>
        <Button
          variant="ghost"
          size="md"
          icon
          disabled={!next}
          title={next ? `Наступний: ${chapterLabel(next)}` : 'Немає наступного'}
          aria-label="Наступний розділ"
          onClick={() => goChapter(next)}
        >
          <IconRight />
        </Button>
      </nav>

      {panel === 'settings' && <SettingsPanel settings={settings} format={format} onClose={() => setPanel('none')} />}
      {panel === 'chapters' && (
        <ChaptersPanel
          chapters={list}
          currentId={chapter?.id ?? ''}
          progress={s.progress.chapters}
          summary={titleProgress(s)}
          onPick={goChapter}
          onClose={() => setPanel('none')}
        />
      )}
    </div>
  );
}

function ChaptersPanel(props: {
  chapters: Chapter[];
  currentId: string;
  progress: Record<string, { pos: number; read: boolean }>;
  summary: { read: number; total: number };
  onPick: (c: Chapter) => void;
  onClose: () => void;
}) {
  const curRef = useRef<HTMLButtonElement>(null);
  useEffect(() => curRef.current?.scrollIntoView({ block: 'center' }), []);
  const pct = props.summary.total ? Math.round((props.summary.read / props.summary.total) * 100) : 0;
  return (
    <aside className="hp-panel hp-panel--left" aria-label="Розділи">
      <div className="hp-panel__head">
        <span className="hp-panel__title">Розділи</span>
        <Button variant="ghost" size="sm" icon onClick={props.onClose} title="Закрити (Esc)" aria-label="Закрити">
          <IconClose />
        </Button>
      </div>
      <div className="hp-panel__summary">
        <div className="hp-row hp-small">
          <span className="hp-grow">
            Прочитано <b>{props.summary.read}</b> з {props.summary.total}
          </span>
          <span className="hp-muted hp-tnum">{pct}%</span>
        </div>
        <Progress value={pct} />
      </div>
      <div className="hp-panel__body hp-panel__body--list">
        {props.chapters.map((c) => {
          const cur = c.id === props.currentId;
          const p = props.progress[chapterKey(c.number)];
          return (
            <button
              key={c.id}
              ref={cur ? curRef : undefined}
              type="button"
              className={`hp-ch ${cur ? 'hp-ch--current' : p?.read ? 'hp-ch--read' : ''}`}
              aria-current={cur || undefined}
              onClick={() => props.onPick(c)}
            >
              <span className="hp-grow hp-ellipsis hp-ch__title">{chapterLabel(c)}</span>
              {p && !p.read && p.pos > 0.01 && <span className="hp-ch__pct">{Math.round(p.pos * 100)}%</span>}
              {p?.read && <IconCheck className="hp-icon hp-ch__done" />}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
