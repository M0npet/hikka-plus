import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { chapterKey, getProgress, posText, updateProgress, updateSettings, useSettings, type ChapterProgress } from '../../core/store';
import { getSource } from '../../sources/registry';
import { chapterLabel, type Chapter, type ChapterContent, type ContentFormat } from '../../sources/types';
import { IconClose, IconExpand, IconExternal, IconLeft, IconList, IconPause, IconPlay, IconRight, IconSettings } from '../../ui/icons';
import { closeReader, moveReader } from '../reader-url';
import { contentFormat, neighbor, setChapterRead, setTeam, teamCounts, titleProgress, useReaderRequest, useTitleState } from '../title-state';
import { SettingsPanel } from './settings-panel';
import { Button, btn, Progress, Select } from '../../ui/kit';
import { NovelView, PagedView, StripView, tapZone, useNearness } from './views';
import { ReaderGlow } from './glow';
import { StatusRing } from '../../ui/status-ring';

type Load =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; content: ChapterContent };

type Images = Extract<ChapterContent, { type: 'images' }>;
/** Розділ у безкінечній стрічці. */
type Seg = { chapter: Chapter; content: Images };
type Auto = 'off' | 'run' | 'pause';

const SAVE_DELAY = 600;

/**
 * Прогрес у стрічці картинок — за сторінками, а не за висотою прокрутки: ще не завантажені
 * сторінки мають висоту-заглушку, тож частка від scrollHeight брехала й стрибала (живий тест MK 2026-11-23).
 * Частка = (номер сторінки під верхом екрана + прогорнута частина цієї сторінки) / кількість сторінок.
 */
function pagesRatio(pages: ArrayLike<HTMLElement>, viewTop: number): number {
  const n = pages.length;
  if (!n) return 0;
  let cur = -1;
  for (let i = 0; i < n; i++) if (pages[i]!.getBoundingClientRect().top <= viewTop) cur = i;
  if (cur < 0) return 0;
  const r = pages[cur]!.getBoundingClientRect();
  const frac = r.height > 0 ? Math.max(0, Math.min(1, (viewTop - r.top) / r.height)) : 0;
  return Math.min(1, (cur + frac) / n);
}
/** За скільки екранів до кінця стрічки підвантажувати наступний розділ. */
const PRELOAD_SCREENS = 3;
const MAX_ZOOM = 3;
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
  const [stripPage, setStripPage] = useState(0); // сторінка під серединою екрана в режимі стрічки
  const [pageInfo, setPageInfo] = useState('');
  const [segs, setSegs] = useState<Seg[]>([]);
  const [feedNext, setFeedNext] = useState<'idle' | 'loading' | 'error'>('idle');
  const [auto, setAuto] = useState<Auto>('off');
  const [zoom, setZoom] = useState(1);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<number | null>(null);
  /** Куди ми самі прокрутили при відновленні позиції — такий стрибок не ховає панелі. */
  const programmaticTop = useRef<number | null>(null);
  /** «Назад» з першої сторінки: попередній розділ відкриваємо з останньої сторінки. */
  const atEndRef = useRef(false);
  const finishedRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastTop = useRef(0);
  const restorePageRef = useRef<number | null>(null);
  /** Розділ, на який ми самі перейшли прокруткою стрічки, — його не перезавантажуємо. */
  const feedMoveRef = useRef<string | null>(null);
  const feedGen = useRef(0);
  const appendingRef = useRef(false);
  const doneRef = useRef(new Set<string>());
  const ptrType = useRef('mouse');
  const holdRef = useRef(false);
  const pinchRef = useRef<{ d0: number; z0: number; cx: number; cy: number; sl: number; st: number } | null>(null);
  const lastTapRef = useRef(0);
  const nearness = useNearness(scrollEl);
  const setScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  const sourceId = req?.sourceId ?? '';
  const source = getSource(sourceId);
  const srcState = s?.sources[sourceId];
  const team = s?.teams[sourceId] ?? '';
  const all = srcState?.chapters ?? [];
  const list = team ? all.filter((c) => c.team === team) : all;
  const chapter: Chapter | undefined = all.find((c) => c.id === req?.chapterId);
  // Той самий розділ від інших команд — для вибору, у кого читати.
  const versions = chapter ? all.filter((c) => chapterKey(c.number) === chapterKey(chapter.number) && c.team) : [];
  const teamChoice = new Set(versions.map((c) => c.team)).size > 1;
  // Скільки розділів у кожної команди — підказка у виборі «у кого читати».
  const counts = useMemo(() => teamCounts(all), [all]);
  const pickTeam = (t: string) => {
    const c = versions.find((v) => v.team === t);
    if (!c || c.id === chapter?.id) return;
    // Обраний фільтр команди в блоці «Розділи» теж переводимо, щоб «далі/назад» ішли за нею.
    if (team && s?.activeId === sourceId) void setTeam(t);
    moveReader({ sourceId, chapterId: c.id });
  };
  const prev = chapter ? neighbor(list.length ? list : all, chapter, -1) : undefined;
  const next = chapter ? neighbor(list.length ? list : all, chapter, 1) : undefined;

  const format: ContentFormat =
    load.status === 'ready' && load.content.type === 'text' ? 'novel' : s ? contentFormat(s) : 'manga';
  const isNovel = format === 'novel';
  const paged = !isNovel && (format === 'manga' ? settings.manga.modeManga : settings.manga.modeWebtoon) === 'paged';
  const feed = !paged && !isNovel && settings.manga.endless;
  const curSeg = feed ? segs.find((x) => x.chapter.id === chapter?.id) : undefined;
  const pageCount = curSeg
    ? curSeg.content.pages.length
    : load.status === 'ready' && load.content.type === 'images'
      ? load.content.pages.length
      : 0;
  const stripWidth = format === 'manga' ? settings.manga.width : settings.manga.widthWebtoon;
  const chList = list.length ? list : all;

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
  const saveFor = useCallback(
    (chapter: Chapter | undefined, p: number, forceRead = false, keepRead = false, pg?: { page: number; pages: number }) => {
      if (!s || !chapter || !source) return;
      const key = chapterKey(chapter.number);
      const done = !keepRead && (forceRead || p >= DONE_AT);
      void updateProgress(s.page.kind, s.page.slug, (pr) => {
        const prevCh = pr.chapters[key];
        return {
          ...pr,
          last: { key, label: chapterLabel(chapter), sourceId: source.id, chapterId: chapter.id },
          chapters: {
            ...pr.chapters,
            [key]: {
              pos: Math.max(0, Math.min(1, p)),
              read: done || !!prevCh?.read,
              at: Date.now(),
              ...(pg ? { page: pg.page, pages: pg.pages } : {}),
            },
          },
        };
      });
    },
    [s, source],
  );
  const save = useCallback(
    (p: number, forceRead = false, keepRead = false, pg?: { page: number; pages: number }) =>
      saveFor(chapter, p, forceRead, keepRead, pg),
    [saveFor, chapter],
  );

  // Завантаження розділу.
  useEffect(() => {
    if (!s || !source || !chapter) return;
    // Перейшли на цей розділ самі, прокручуючи стрічку, — він уже на екрані.
    if (feedMoveRef.current === chapter.id) {
      feedMoveRef.current = null;
      return;
    }
    feedMoveRef.current = null;
    let alive = true;
    feedGen.current++;
    appendingRef.current = false;
    doneRef.current = new Set();
    setSegs([]);
    setFeedNext('idle');
    setLoad({ status: 'loading' });
    setPos(0);
    setPageInfo('');
    finishedRef.current = false;
    scrollRef.current?.scrollTo({ top: 0 });

    (async () => {
      // Відновлюємо місце, якщо розділ почали, але не дочитали.
      const pr = await getProgress(s.page.kind, s.page.slug);
      const cp = pr.chapters[chapterKey(chapter.number)];
      const atEnd = atEndRef.current;
      atEndRef.current = false;
      restoreRef.current = atEnd ? null : cp && !cp.read && cp.pos > 0.01 && cp.pos < DONE_AT ? cp.pos : null;
      const restorePage = restoreRef.current != null && cp?.page != null ? cp.page : null;
      restorePageRef.current = restorePage;
      try {
        const content = await source.getContent(chapter);
        if (!alive) return;
        const r = restoreRef.current;
        if (atEnd && content.type === 'images' && content.pages.length > 0) {
          // Остання сторінка; сам перехід назад не відмічає розділ прочитаним.
          const n = content.pages.length;
          setPage(n - 1);
          setPos(1);
          setLoad({ status: 'ready', content });
          save(1, false, true, { page: n - 1, pages: n });
          return;
        }
        if (content.type === 'images') {
          const n = content.pages.length;
          const p = restorePage != null && restorePage < n ? restorePage : r != null ? Math.round(r * Math.max(0, n - 1)) : 0;
          setPage(p);
          setPos(r ?? 0);
          setSegs([{ chapter, content }]);
          setLoad({ status: 'ready', content });
          save(r ?? 0, false, false, { page: p, pages: n });
          return;
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
    let applied: number | null = null;
    const apply = () => {
      // Прокрутили після нашого стрибка (зони кліку, автопрокрутка, перетягування) — більше не чіпаємо.
      if (applied != null && Math.abs(el.scrollTop - applied) > 2) userMoved = true;
      if (userMoved) return;
      // Спершу — за номером сторінки (висоти ще не завантажених картинок приблизні), інакше — за часткою.
      const box = el.getBoundingClientRect();
      const base = el.querySelector<HTMLElement>('[data-seg]');
      const pg = restorePageRef.current;
      const pgEl = pg != null ? el.querySelector<HTMLElement>(`[data-page="${pg}"]`) : null;
      let top: number;
      if (pgEl) top = pgEl.getBoundingClientRect().top - box.top + el.scrollTop;
      else if (base) {
        const r = base.getBoundingClientRect();
        top = r.top - box.top + el.scrollTop + ratio * Math.max(0, r.height - el.clientHeight);
      } else top = ratio * (el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - top) < 1) return;
      programmaticTop.current = top;
      el.scrollTop = top;
      applied = el.scrollTop;
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
      setPanel('none');
      // У стрічці розділ уже підвантажений — просто прокрутити до нього.
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-seg="${CSS.escape(c.id)}"]`);
      if (el && scrollRef.current) {
        const box = scrollRef.current.getBoundingClientRect();
        scrollRef.current.scrollTo({ top: el.getBoundingClientRect().top - box.top + scrollRef.current.scrollTop });
        return;
      }
      restoreRef.current = null;
      restorePageRef.current = null;
      moveReader({ sourceId, chapterId: c.id });
    },
    [sourceId],
  );

  /** Підвантажити наступний розділ у кінець стрічки. */
  const appendNext = useCallback(() => {
    const last = segs[segs.length - 1];
    if (!source || !last || appendingRef.current) return;
    const nx = neighbor(chList, last.chapter, 1);
    if (!nx || segs.some((x) => x.chapter.id === nx.id)) return;
    appendingRef.current = true;
    const gen = feedGen.current;
    setFeedNext('loading');
    source
      .getContent(nx)
      .then((c) => {
        if (gen !== feedGen.current) return;
        if (c.type !== 'images') return setFeedNext('error');
        setSegs((x) => (x.some((y) => y.chapter.id === nx.id) ? x : [...x, { chapter: nx, content: c }]));
        setFeedNext('idle');
      })
      .catch(() => gen === feedGen.current && setFeedNext('error'))
      .finally(() => {
        if (gen === feedGen.current) appendingRef.current = false;
      });
  }, [segs, source, chList]);

  const setPageAndSave = useCallback(
    (p: number) => {
      setPage(p);
      const ratio = pageCount > 1 ? p / (pageCount - 1) : 1;
      setPos(ratio);
      save(ratio, p >= pageCount - 1, false, { page: p, pages: pageCount });
    },
    [pageCount, save],
  );

  const goPage = useCallback(
    (dir: -1 | 1) => {
      if (dir === 1) {
        if (page + 1 < pageCount) setPageAndSave(page + 1);
        else goChapter(next);
      } else if (page > 0) setPageAndSave(page - 1);
      else if (prev) {
        atEndRef.current = true;
        goChapter(prev);
      }
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
    const viewTop = el.getBoundingClientRect().top;
    const atEnd = max - top < 40;
    const ratio = isNovel
      ? Math.min(1, top / max)
      : atEnd
        ? 1
        : pagesRatio(el.querySelectorAll<HTMLElement>('[data-page]'), viewTop);
    setPos(ratio);

    // Стрибок від відновлення позиції — не прокрутка користувача: панелі лишаються.
    const own = programmaticTop.current != null && Math.abs(top - programmaticTop.current) < 2;
    programmaticTop.current = null;
    if (settings.autoHideBars && panel === 'none' && !own && auto !== 'run') {
      if (top - lastTop.current > 12 && top > 80) setBarsHidden(true);
      else if (lastTop.current - top > 12) setBarsHidden(false);
    }
    lastTop.current = top;

    if (feed) return onFeedScroll(el, top, own);

    let pg: { page: number; pages: number } | undefined;
    if (!isNovel) {
      const imgs = el.querySelectorAll<HTMLElement>('[data-page]');
      const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
      let cur = 0;
      for (const img of imgs) if (img.getBoundingClientRect().top <= mid) cur = Number(img.dataset.page);
      pg = { page: cur, pages: imgs.length };
      setStripPage(cur);
      if (settings.manga.pageNumbers) setPageInfo(`${cur + 1} / ${imgs.length}`);
    }

    if ((ratio >= DONE_AT || max - top < 40) && !finishedRef.current) {
      finishedRef.current = true;
      save(1, true, false, pg && { page: pg.pages - 1, pages: pg.pages });
      return;
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(ratio, false, false, pg), SAVE_DELAY);
  };

  /** Стрічка з кількох розділів: поточний — той, що посередині екрана; адреса й прогрес — за ним. */
  const onFeedScroll = (el: HTMLDivElement, top: number, own: boolean) => {
    const box = el.getBoundingClientRect();
    const mid = box.top + el.clientHeight / 2;
    const sections = [...el.querySelectorAll<HTMLElement>('[data-seg]')];
    let cur = sections[0];
    for (const sec of sections) if (sec.getBoundingClientRect().top <= mid) cur = sec;
    if (!cur) return;
    const id = cur.dataset.seg;
    const seg = segs.find((x) => x.chapter.id === id);
    if (!seg) return;
    const r = cur.getBoundingClientRect();
    const pages = cur.querySelectorAll<HTMLElement>('[data-page]');
    const segEnd = r.bottom - (box.top + el.clientHeight) < 40;
    const ratio = segEnd ? 1 : pagesRatio(pages, box.top);
    setPos(ratio);

    let pgNo = 0;
    for (const p of pages) if (p.getBoundingClientRect().top <= mid) pgNo = Number(p.dataset.page);
    const pg = { page: pgNo, pages: pages.length };
    setStripPage(pgNo);
    if (settings.manga.pageNumbers) setPageInfo(`${pgNo + 1} / ${pages.length}`);

    // Перейшли в наступний розділ: попередні — прочитані, адреса — на новий.
    if (seg.chapter.id !== chapter?.id) {
      const k = segs.indexOf(seg);
      const was = segs.findIndex((x) => x.chapter.id === chapter?.id);
      if (was >= 0 && k > was)
        for (const x of segs.slice(was, k))
          if (!doneRef.current.has(x.chapter.id)) {
            doneRef.current.add(x.chapter.id);
            saveFor(x.chapter, 1, true, false, { page: x.content.pages.length - 1, pages: x.content.pages.length });
          }
      feedMoveRef.current = seg.chapter.id;
      moveReader({ sourceId, chapterId: seg.chapter.id });
    }

    if ((ratio >= DONE_AT || segEnd) && !doneRef.current.has(seg.chapter.id)) {
      doneRef.current.add(seg.chapter.id);
      saveFor(seg.chapter, 1, true, false, { page: pg.pages - 1, pages: pg.pages });
    } else if (!doneRef.current.has(seg.chapter.id) && !own) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveFor(seg.chapter, ratio, false, false, pg), SAVE_DELAY);
    }

    // Наближаємось до кінця — підвантажуємо наступний розділ.
    if (el.scrollHeight - top - el.clientHeight < PRELOAD_SCREENS * el.clientHeight && feedNext === 'idle') appendNext();
  };

  // Автопрокрутка: плавно, з урахуванням дробових пікселів; палець на екрані — пауза.
  useEffect(() => {
    if (auto !== 'run' || paged) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const el = scrollRef.current;
      if (el && !holdRef.current) {
        acc += settings.manga.autoSpeed * dt;
        const d = Math.floor(acc);
        if (d >= 1) {
          acc -= d;
          el.scrollTop += d;
        }
        const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
        if (atEnd && !(feed && feedNext === 'loading')) {
          setAuto('pause');
          setBarsHidden(false);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [auto, paged, feed, feedNext, settings.manga.autoSpeed]);

  // Масштаб щипком: тримаємо під пальцями ту саму точку.
  useLayoutEffect(() => {
    const p = pinchRef.current;
    const el = scrollRef.current;
    if (!p || !el) return;
    const k = zoom / p.z0;
    el.scrollLeft = (p.sl + p.cx) * k - p.cx;
    el.scrollTop = (p.st + p.cy) * k - p.cy;
  }, [zoom]);

  const touchDist = (e: TouchEvent) => {
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    holdRef.current = true;
    if (e.touches.length === 2 && !paged && !isNovel) {
      const el = e.currentTarget;
      const box = el.getBoundingClientRect();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      pinchRef.current = {
        d0: touchDist(e),
        z0: zoom,
        cx: (a.clientX + b.clientX) / 2 - box.left,
        cy: (a.clientY + b.clientY) / 2 - box.top,
        sl: el.scrollLeft,
        st: el.scrollTop,
      };
    }
  };
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const p = pinchRef.current;
    if (!p || e.touches.length !== 2) return;
    const z = Math.max(1, Math.min(MAX_ZOOM, (p.z0 * touchDist(e)) / Math.max(1, p.d0)));
    if (Math.abs(z - zoom) > 0.01) setZoom(z);
  };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) holdRef.current = false;
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
          // Відкритий список (Select) закривається сам — панель і читалку не чіпаємо.
          if (e.defaultPrevented || rootRef.current?.querySelector('.hp-popover')) return;
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
        case ' ':
          if (typing || auto === 'off') return;
          setAuto(auto === 'run' ? 'pause' : 'run');
          break;
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
  }, [panel, paged, auto, settings.manga.rtl, goPage, goChapter, next, prev, toggleFullscreen]);

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
      {!isNovel && <ZoneOverlay root={rootRef.current} scroll={scrollEl} paged={paged} />}
      {!isNovel && settings.manga.glow && (
        <ReaderGlow
          root={rootRef.current}
          scroll={scrollEl}
          level={settings.manga.glowLevel}
          bright={settings.manga.glowBright}
          tick={`${req?.chapterId}:${page}:${load.status}:${zoom}`}
        />
      )}

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
        {teamChoice && chapter?.team && (
          <Select
            className="hp-bar__team"
            title="Команда перекладу цього розділу"
            value={chapter.team}
            onChange={pickTeam}
            options={[...new Set(versions.map((v) => v.team!))].map((t) => ({ value: t, label: t, hint: String(counts.get(t) ?? '') }))}
          />
        )}
        <span className="hp-small hp-muted hp-tnum hp-bar__pct">
          {posText(pageCount > 0 ? { pos, page: paged ? page : stripPage, pages: pageCount } : { pos })}
        </span>
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
        ref={setScroll}
        className={[
          'hp-reader__scroll',
          !paged && !isNovel && 'hp-reader__scroll--touch',
          zoom > 1 && 'hp-reader__scroll--zoomed',
        ]
          .filter(Boolean)
          .join(' ')}
        tabIndex={-1}
        onScroll={onScroll}
        onPointerDown={(e) => (ptrType.current = e.pointerType)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={(e) => {
          if (paged || (e.target as HTMLElement).closest('a,button,input')) return;
          if (panel !== 'none') return setPanel('none');
          // Дотик під час автопрокрутки — пауза.
          if (auto === 'run') {
            setAuto('pause');
            setBarsHidden(false);
            return;
          }
          if (window.getSelection()?.toString()) return;
          const el = e.currentTarget;
          if (!isNovel) {
            const now = Date.now();
            // Збільшено щипком: подвійний тап — скинути масштаб, зони не працюють.
            if (zoom > 1) {
              if (ptrType.current === 'touch' && now - lastTapRef.current < 320) {
                pinchRef.current = null;
                setZoom(1);
              }
              lastTapRef.current = now;
              return;
            }
            // Область «Зображення»: зони лише по самій сторінці, поза нею — тільки панелі.
            const onImage = !!(e.target as HTMLElement).closest('.hp-strip__pg');
            if (settings.manga.clickArea === 'screen' || onImage) {
              const r = el.getBoundingClientRect();
              const d = tapZone(settings.manga.tapScheme, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
              if (d !== 0) {
                el.scrollBy({ top: d * el.clientHeight * 0.67, behavior: 'smooth' });
                return;
              }
            }
          }
          setBarsHidden((v) => !v);
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
        {load.status === 'ready' && load.content.type === 'images' && !paged && !feed && (
          <StripView content={load.content} s={settings.manga} width={stripWidth} nearness={nearness} zoom={zoom} />
        )}
        {load.status === 'ready' && feed && (
          <div className="hp-feed">
            {segs.map((sg, k) => (
              <section
                key={sg.chapter.id}
                data-seg={sg.chapter.id}
                style={k > 0 && !settings.manga.feedSep ? { paddingTop: settings.manga.gap } : undefined}
              >
                {k > 0 && settings.manga.feedSep && (
                  <div className="hp-feed__sep">
                    <span className="hp-xs hp-muted">Кінець «{chapterLabel(segs[k - 1]!.chapter)}»</span>
                    <b>{chapterLabel(sg.chapter)}</b>
                    {sg.chapter.team && <span className="hp-xs hp-muted">переклад: {sg.chapter.team}</span>}
                  </div>
                )}
                <StripView feed content={sg.content} s={settings.manga} width={stripWidth} nearness={nearness} zoom={zoom} />
              </section>
            ))}
            {feedNext === 'loading' && (
              <div className="hp-error">
                <span className="hp-spinner" aria-hidden="true" />
                Завантаження наступного розділу…
              </div>
            )}
          </div>
        )}
        {load.status === 'ready' && load.content.type === 'images' && paged && (
          <PagedView
            content={load.content}
            page={page}
            s={settings.manga}
            onZone={(d) => (d === 0 ? setBarsHidden((v) => !v) : goPage(d))}
          />
        )}
        {load.status === 'ready' && !paged && (!feed || (feedNext !== 'loading' && !feedHasNext(segs, chList))) && (
          <div className="hp-end">
            <div className="hp-muted hp-small">Кінець розділу{chapter?.team ? ` · переклад: ${chapter.team}` : ''}</div>
            {feed && feedNext === 'error' && <div className="hp-small">Не вдалося завантажити наступний розділ.</div>}
            {feed && feedNext === 'error' && segs.length > 0 && neighbor(chList, segs[segs.length - 1]!.chapter, 1) ? (
              <Button variant="default" size="lg" onClick={() => { setFeedNext('idle'); appendNext(); }}>
                Спробувати ще раз
              </Button>
            ) : next && !feed ? (
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

      {!paged && auto !== 'off' && (
        <div className="hp-auto" role="group" aria-label="Автопрокрутка">
          <Button
            variant="ghost"
            size="sm"
            icon
            title={auto === 'run' ? 'Пауза (Пробіл)' : 'Продовжити (Пробіл)'}
            aria-label={auto === 'run' ? 'Пауза' : 'Продовжити'}
            onClick={() => setAuto(auto === 'run' ? 'pause' : 'run')}
          >
            {auto === 'run' ? <IconPause /> : <IconPlay />}
          </Button>
          <input
            type="range"
            min={20}
            max={400}
            step={10}
            value={settings.manga.autoSpeed}
            aria-label="Швидкість автопрокрутки"
            title="Швидкість"
            onChange={(e) => {
              const autoSpeed = Number(e.currentTarget.value);
              void updateSettings((x) => ({ ...x, manga: { ...x.manga, autoSpeed } }));
            }}
          />
          <span className="hp-xs hp-muted hp-tnum">{settings.manga.autoSpeed}</span>
          <Button variant="ghost" size="sm" icon title="Вимкнути автопрокрутку" aria-label="Вимкнути автопрокрутку" onClick={() => setAuto('off')}>
            <IconClose />
          </Button>
        </div>
      )}
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
        {!paged && (
          <Button
            variant="ghost"
            size="md"
            icon
            aria-pressed={auto !== 'off'}
            title={auto === 'off' ? 'Автопрокрутка' : 'Вимкнути автопрокрутку'}
            aria-label="Автопрокрутка"
            onClick={() => setAuto(auto === 'off' ? 'run' : 'off')}
          >
            {auto === 'run' ? <IconPause /> : <IconPlay />}
          </Button>
        )}
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

/** Чи є ще розділ після останнього в стрічці. */
function feedHasNext(segs: Seg[], list: Chapter[]) {
  const last = segs[segs.length - 1];
  return !!last && !!neighbor(list, last.chapter, 1);
}

function ChaptersPanel(props: {
  chapters: Chapter[];
  currentId: string;
  progress: Record<string, ChapterProgress>;
  summary: { read: number; total: number };
  onPick: (c: Chapter) => void;
  onClose: () => void;
}) {
  const curRef = useRef<HTMLDivElement>(null);
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
          const read = !!p?.read;
          const pos = p?.pos ?? 0;
          // Як у блоці «Розділи»: кружечок ліворуч — відмітити прочитаним/непрочитаним, решта рядка — відкрити.
          return (
            <div
              key={c.id}
              ref={cur ? curRef : undefined}
              role="button"
              tabIndex={0}
              className={['hp-ch', read && 'hp-ch--read', cur && 'hp-ch--current'].filter(Boolean).join(' ')}
              aria-current={cur || undefined}
              onClick={() => props.onPick(c)}
              onKeyDown={(e) => e.key === 'Enter' && props.onPick(c)}
            >
              <button
                type="button"
                className={`hp-status ${read ? 'hp-status--read' : ''}`}
                title={read ? 'Позначити непрочитаним' : 'Позначити прочитаним'}
                onClick={(e) => {
                  e.stopPropagation();
                  void setChapterRead(c, !read);
                }}
              >
                <StatusRing pos={pos} read={read} />
              </button>
              <span className="hp-ellipsis hp-ch__title">{chapterLabel(c)}</span>
              {!read && p && pos > 0.01 && <span className="hp-ch__pct">{posText(p)}</span>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/**
 * Підсвітка зон кліку поверх сторінки (як у Senkuro) — коротко після зміни схеми зон чи «Де працюють зони».
 * Геометрія та сама, що в обробниках кліку: стрічка — зони від екрана читалки (на «На сторінці» — лише над картинкою),
 * посторінково — від сторінки (видима частина), з урахуванням напряму гортання.
 */
function ZoneOverlay({ root, scroll, paged }: { root: HTMLElement | null; scroll: HTMLElement | null; paged: boolean }) {
  const settings = useSettings();
  const m = settings.manga;
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; clip?: [number, number] } | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!root || !scroll || m.tapScheme === 'off') return setBox(null);
    const rr = root.getBoundingClientRect();
    let r: DOMRect;
    let clip: [number, number] | undefined;
    if (paged) {
      const el = scroll.querySelector<HTMLElement>(m.clickArea === 'image' ? '.hp-page img' : '.hp-page');
      if (!el) return;
      const b = el.getBoundingClientRect();
      const top = Math.max(b.top, rr.top);
      r = new DOMRect(b.left, top, b.width, Math.min(b.bottom, rr.bottom) - top);
    } else {
      r = scroll.getBoundingClientRect();
      if (m.clickArea === 'image') {
        const pg = scroll.querySelector<HTMLElement>('.hp-strip__pg');
        if (pg) {
          const b = pg.getBoundingClientRect();
          clip = [Math.max(0, b.left - r.left), Math.max(0, r.right - b.right)];
        }
      }
    }
    setBox({ x: r.left - rr.left, y: r.top - rr.top, w: r.width, h: r.height, clip });
    const t = window.setTimeout(() => setBox(null), 2200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.tapScheme, m.clickArea]);
  if (!box) return null;
  const rtl = paged && m.rtl;
  const cells = [1 / 6, 1 / 2, 5 / 6].flatMap((y) => [1 / 6, 1 / 2, 5 / 6].map((x) => tapZone(m.tapScheme, x, y, rtl)));
  return (
    <div
      className="hp-zones"
      aria-hidden="true"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        clipPath: box.clip ? `inset(0 ${box.clip[1]}px 0 ${box.clip[0]}px)` : undefined,
      }}
    >
      {cells.map((d, i) => (
        <span key={i} className={`hp-zones__c hp-zones__c--${d < 0 ? 'prev' : d > 0 ? 'next' : 'menu'}`} />
      ))}
      {/* Підписи — по центру зон «Назад»/«Далі» (як у Senkuro), «Меню» — у середній клітинці. */}
      {(['prev', 'menu', 'next'] as const).map((k) => {
        const idx = cells.map((d, i) => ((d < 0 ? 'prev' : d > 0 ? 'next' : 'menu') === k ? i : -1)).filter((i) => i >= 0);
        if (!idx.length || (k === 'menu' && !idx.includes(4))) return null;
        const at = k === 'menu' ? [4] : idx;
        const cx = at.reduce((a, i) => a + (i % 3), 0) / at.length;
        const cy = at.reduce((a, i) => a + Math.floor(i / 3), 0) / at.length;
        return (
          <b key={k} className="hp-zones__label" style={{ left: `${((cx + 0.5) / 3) * 100}%`, top: `${((cy + 0.5) / 3) * 100}%` }}>
            {k === 'prev' ? 'Назад' : k === 'next' ? 'Далі' : 'Меню'}
          </b>
        );
      })}
    </div>
  );
}
