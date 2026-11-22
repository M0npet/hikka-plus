import { useCallback, useEffect, useRef, useState } from 'react';
import { getProgress, patchProgress, useSettings } from '../../core/store';
import { chapterLabel, type Chapter, type ChapterContent, type ContentFormat } from '../../sources/types';
import { IconClose, IconExpand, IconExternal, IconLeft, IconList, IconRight, IconSettings } from '../../ui/icons';
import { closeReader, useReaderRequest, useTitleState } from '../title-state';
import { SettingsPanel } from './settings-panel';
import { NovelView, PagedView, StripView } from './views';

type Load =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; content: ChapterContent };

const SAVE_DELAY = 600;

export function Reader() {
  const s = useTitleState();
  const req = useReaderRequest();
  const settings = useSettings();

  const [chapterId, setChapterId] = useState(req?.chapterId ?? '');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [panel, setPanel] = useState<'none' | 'chapters' | 'settings'>('none');
  const [barsHidden, setBarsHidden] = useState(false);
  const [page, setPage] = useState(0);
  const [pageInfo, setPageInfo] = useState('');
  const [finished, setFinished] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<number | null>(null); // позиція для відновлення
  const firstOpen = useRef(true);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastTop = useRef(0);

  const chapters = s?.chapters ?? [];
  const idx = chapters.findIndex((c) => c.id === chapterId);
  const chapter: Chapter | undefined = chapters[idx];
  const prev = idx > 0 ? chapters[idx - 1] : undefined;
  const next = idx >= 0 && idx + 1 < chapters.length ? chapters[idx + 1] : undefined;

  const format: ContentFormat =
    load.status === 'ready' && load.content.type === 'text' ? 'novel' : (s?.remote?.format ?? 'webtoon');
  const isNovel = format === 'novel';
  const mangaMode = format === 'manga' ? settings.manga.modeManga : settings.manga.modeWebtoon;
  const paged = !isNovel && mangaMode === 'paged';
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

  useEffect(() => {
    if (req && req.chapterId !== chapterId) setChapterId(req.chapterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const save = useCallback(
    (patch: { position?: number; read?: boolean }) => {
      if (!s?.source || !s.remote || !chapter) return;
      const { kind, slug } = s.page;
      const base = { sourceId: s.source.id, remoteId: s.remote.id };
      void (async () => {
        const cur = await getProgress(kind, slug);
        const sameTitle = cur?.sourceId === base.sourceId && cur?.remoteId === base.remoteId;
        const read = new Set(sameTitle ? cur!.read : []);
        if (patch.read) read.add(chapter.id);
        await patchProgress(kind, slug, {
          ...base,
          chapterId: chapter.id,
          chapterLabel: chapterLabel(chapter),
          position: patch.position ?? (sameTitle && cur!.chapterId === chapter.id ? cur!.position : 0),
          read: [...read],
        });
      })();
    },
    [s, chapter],
  );

  // Завантаження розділу.
  useEffect(() => {
    if (!s?.source || !chapter) return;
    let alive = true;
    setLoad({ status: 'loading' });
    setFinished(false);
    setPageInfo('');

    const resume = firstOpen.current && !!req?.resume;
    firstOpen.current = false;

    (async () => {
      const prog = resume ? await getProgress(s.page.kind, s.page.slug) : null;
      restoreRef.current = prog?.chapterId === chapter.id ? prog.position : null;
      try {
        const content = await s.source!.getContent(chapter);
        if (!alive) return;
        setPage(restoreRef.current != null && content.type === 'images' ? Math.round(restoreRef.current) : 0);
        setLoad({ status: 'ready', content });
        save({ position: restoreRef.current ?? 0 });
      } catch (e) {
        if (alive) setLoad({ status: 'error', error: String(e instanceof Error ? e.message : e) });
      }
    })();

    scrollRef.current?.scrollTo({ top: 0 });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, s?.source?.id]);

  // Відновлення позиції прокрутки (картинки догружаються — пробуємо кілька разів).
  useEffect(() => {
    if (load.status !== 'ready' || paged) return;
    const ratio = restoreRef.current;
    if (ratio == null || ratio <= 0) return;
    const el = scrollRef.current;
    if (!el) return;
    let userMoved = false;
    const mark = () => (userMoved = true);
    el.addEventListener('wheel', mark, { once: true });
    el.addEventListener('touchstart', mark, { once: true });
    const apply = () => {
      if (!userMoved) el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    };
    const timers = [50, 400, 1200, 2500].map((t) => window.setTimeout(apply, t));
    return () => {
      timers.forEach(clearTimeout);
      el.removeEventListener('wheel', mark);
      el.removeEventListener('touchstart', mark);
    };
  }, [load, paged]);

  const goChapter = useCallback((c?: Chapter) => {
    if (!c) return;
    restoreRef.current = null;
    setPanel('none');
    setChapterId(c.id);
  }, []);

  const finish = useCallback(() => {
    if (finished) return;
    setFinished(true);
    save({ read: true });
  }, [finished, save]);

  const goPage = useCallback(
    (dir: -1 | 1) => {
      if (dir === 1) {
        if (page + 1 < pageCount) {
          setPage(page + 1);
          save({ position: page + 1 });
          if (page + 2 >= pageCount) finish();
        } else if (next) goChapter(next);
      } else if (page > 0) {
        setPage(page - 1);
        save({ position: page - 1 });
      } else if (prev) goChapter(prev);
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [page, pageCount, next, prev, goChapter, save, finish],
  );

  // Прокрутка: ховаємо панелі, зберігаємо позицію, відмічаємо прочитане.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || paged || load.status !== 'ready') return;
    const top = el.scrollTop;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, top / max);

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

    if (ratio > 0.985 || max - top < 40) finish();
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save({ position: ratio }), SAVE_DELAY);
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
  const title = s.hikka?.title_ua || s.hikka?.title_en || s.remote?.title || '';
  const label = chapter ? chapterLabel(chapter) : '';

  return (
    <div
      ref={rootRef}
      className={`hp-reader ${themeCls} ${barsHidden ? 'hp-bars-hidden' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Читалка: ${title}`}
    >
      {/* Верхня панель */}
      <header className="hp-bar hp-bar--top">
        <button type="button" className="hp-btn hp-btn--ghost hp-btn--icon" title="Закрити (Esc)" onClick={closeReader}>
          <IconClose />
        </button>
        <div className="hp-bar__title hp-grow">
          <b className="hp-ellipsis">{title}</b>
          <span className="hp-ellipsis">
            {label}
            {chapter?.team ? ` · ${chapter.team}` : ''}
          </span>
        </div>
        {chapter && (
          <a
            className="hp-btn hp-btn--ghost hp-btn--icon"
            href={chapter.url}
            target="_blank"
            rel="noreferrer"
            title={`Відкрити на ${s.source?.name}`}
          >
            <IconExternal />
          </a>
        )}
        <button type="button" className="hp-btn hp-btn--ghost hp-btn--icon" title="Повний екран (F)" onClick={toggleFullscreen}>
          <IconExpand />
        </button>
      </header>

      {/* Вміст */}
      <div
        ref={scrollRef}
        className="hp-reader__scroll"
        tabIndex={-1}
        onScroll={onScroll}
        onClick={(e) => {
          if (paged || e.target !== e.currentTarget && (e.target as HTMLElement).closest('a,button')) return;
          if (panel !== 'none') setPanel('none');
          else setBarsHidden((v) => !v);
        }}
      >
        {load.status === 'loading' && <div className="hp-error">Завантаження…</div>}
        {load.status === 'error' && (
          <div className="hp-error">
            <div>{load.error}</div>
            {chapter && (
              <a className="hp-btn" href={chapter.url} target="_blank" rel="noreferrer">
                Відкрити на {s.source?.name}
              </a>
            )}
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
            <div className="hp-muted hp-small">Кінець розділу</div>
            {next ? (
              <button type="button" className="hp-btn hp-btn--primary" onClick={() => goChapter(next)}>
                Далі: {chapterLabel(next)}
                <IconRight />
              </button>
            ) : (
              <div>Це останній доступний розділ.</div>
            )}
            <button type="button" className="hp-btn hp-btn--ghost" onClick={closeReader}>
              До сторінки тайтлу
            </button>
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
        <button
          type="button"
          className="hp-btn hp-btn--ghost hp-btn--icon"
          disabled={!prev}
          title={prev ? `Попередній: ${chapterLabel(prev)}` : 'Немає попереднього'}
          onClick={() => goChapter(prev)}
        >
          <IconLeft />
        </button>
        <button
          type="button"
          className={`hp-btn hp-btn--ghost hp-btn--icon ${panel === 'chapters' ? 'hp-btn--active' : ''}`}
          title="Усі розділи"
          onClick={() => setPanel(panel === 'chapters' ? 'none' : 'chapters')}
        >
          <IconList />
        </button>
        <span className="hp-small hp-muted" style={{ padding: '0 6px', whiteSpace: 'nowrap' }}>
          {idx + 1} / {chapters.length}
        </span>
        <button
          type="button"
          className={`hp-btn hp-btn--ghost hp-btn--icon ${panel === 'settings' ? 'hp-btn--active' : ''}`}
          title="Налаштування"
          onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
        >
          <IconSettings />
        </button>
        <button
          type="button"
          className="hp-btn hp-btn--ghost hp-btn--icon"
          disabled={!next}
          title={next ? `Наступний: ${chapterLabel(next)}` : 'Немає наступного'}
          onClick={() => goChapter(next)}
        >
          <IconRight />
        </button>
      </nav>

      {panel === 'settings' && (
        <SettingsPanel settings={settings} format={format} onClose={() => setPanel('none')} />
      )}
      {panel === 'chapters' && (
        <ChaptersPanel
          chapters={chapters}
          currentId={chapterId}
          readIds={
            s.progress && s.progress.sourceId === s.source?.id && s.progress.remoteId === s.remote?.id
              ? s.progress.read
              : []
          }
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
  readIds: string[];
  onPick: (c: Chapter) => void;
  onClose: () => void;
}) {
  const curRef = useRef<HTMLButtonElement>(null);
  const read = new Set(props.readIds);
  useEffect(() => curRef.current?.scrollIntoView({ block: 'center' }), []);
  return (
    <aside className="hp-panel hp-panel--left" aria-label="Розділи">
      <div className="hp-panel__head">
        <span className="hp-grow">Розділи</span>
        <button type="button" className="hp-btn hp-btn--ghost hp-btn--icon" onClick={props.onClose} title="Закрити">
          <IconClose />
        </button>
      </div>
      <div className="hp-panel__body" style={{ padding: '0 8px 16px' }}>
        {props.chapters.map((c) => {
          const cur = c.id === props.currentId;
          return (
            <button
              key={c.id}
              ref={cur ? curRef : undefined}
              type="button"
              className={`hp-ch ${cur ? 'hp-ch--current' : read.has(c.id) ? 'hp-ch--read' : ''}`}
              onClick={() => props.onPick(c)}
            >
              <span className="hp-grow hp-ellipsis hp-ch__title">{chapterLabel(c)}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
