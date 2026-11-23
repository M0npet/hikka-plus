import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { ReaderSettings, TapScheme } from '../../core/store';
import type { ChapterContent } from '../../sources/types';

const FONTS: Record<ReaderSettings['novel']['font'], string> = {
  site: 'inherit',
  serif: 'Literata, Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", Consolas, monospace',
};

export function NovelView({ html, title, s }: { html: string; title: string; s: ReaderSettings['novel'] }) {
  const clean = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input'],
        FORBID_ATTR: ['style', 'class', 'id'],
      }).replace(/<img /g, '<img referrerpolicy="no-referrer" loading="lazy" '),
    [html],
  );
  // Якщо розділ сам починається із заголовка — свій не дублюємо.
  const ownHeading = /^\s*<h[1-4][\s>]/i.test(clean);
  const cls = ['hp-novel', s.indent && 'hp-novel--indent', s.justify && 'hp-novel--justify'].filter(Boolean).join(' ');
  return (
    <article
      className={cls}
      lang="uk"
      style={{
        maxWidth: s.width,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontFamily: FONTS[s.font],
        ['--hp-pgap' as string]: `${s.paragraphGap}em`,
      }}
    >
      {!ownHeading && <h1 className="hp-novel__head">{title}</h1>}
      <div className="hp-novel__text" dangerouslySetInnerHTML={{ __html: clean }} />
    </article>
  );
}

type Images = Extract<ChapterContent, { type: 'images' }>;

/** Куди веде клік у точці (x, y — частки 0..1 від екрана/зображення): -1 назад, 1 далі, 0 — панелі. */
export function tapZone(scheme: TapScheme, x: number, y: number, rtl = false): -1 | 0 | 1 {
  if (rtl) x = 1 - x;
  const h = x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : 0;
  const v = y < 1 / 3 ? -1 : y > 2 / 3 ? 1 : 0;
  if (scheme === 'lr') return h;
  if (scheme === 'tb') return v;
  if (scheme === 'l') return v !== 0 ? v : h;
  return 0;
}

/**
 * Спільні спостерігачі для картинок стрічки: «близько» (вантажимо заздалегідь, ~3 екрани вниз)
 * і «далеко» (вивантажуємо, щоб довга стрічка не їла пам'ять; висота лишається — без стрибків).
 */
export type Nearness = { observe: (el: Element, cb: (near: boolean, far: boolean) => void) => () => void };

export function useNearness(root: HTMLElement | null): Nearness | null {
  return useMemo(() => {
    if (!root || typeof IntersectionObserver === 'undefined') return null;
    const cbs = new Map<Element, (near: boolean, far: boolean) => void>();
    const near = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && cbs.get(e.target)?.(true, false)),
      { root, rootMargin: '150% 0px 300% 0px' },
    );
    const far = new IntersectionObserver(
      (es) => es.forEach((e) => !e.isIntersecting && cbs.get(e.target)?.(false, true)),
      { root, rootMargin: '800% 0px 800% 0px' },
    );
    return {
      observe(el, cb) {
        cbs.set(el, cb);
        near.observe(el);
        far.observe(el);
        return () => {
          cbs.delete(el);
          near.unobserve(el);
          far.unobserve(el);
        };
      },
    };
  }, [root]);
}

function StripImg({
  url,
  i,
  eager,
  original,
  nearness,
}: {
  url: string;
  i: number;
  eager: boolean;
  original: boolean;
  nearness: Nearness | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(eager || !nearness);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !nearness) return;
    return nearness.observe(el, (near, far) => {
      if (near) setOn(true);
      else if (far) setOn(false);
    });
  }, [nearness]);
  return (
    <div
      ref={ref}
      className={`hp-strip__pg ${size ? 'hp-strip__pg--sized' : ''}`}
      data-page={i}
      style={size ? { aspectRatio: `${size.w} / ${size.h}`, ...(original ? { width: `min(${size.w}px, 100vw)` } : {}) } : undefined}
    >
      {on && (
        <img
          src={url}
          alt={`Сторінка ${i + 1}`}
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth && im.naturalHeight) setSize({ w: im.naturalWidth, h: im.naturalHeight });
          }}
        />
      )}
    </div>
  );
}

export function StripView({
  content,
  s,
  width,
  nearness,
  zoom = 1,
  feed = false,
}: {
  feed?: boolean;
  content: Images;
  s: ReaderSettings['manga'];
  width: number;
  nearness: Nearness | null;
  /** Масштаб щипком (1 — звичайна ширина). */
  zoom?: number;
}) {
  const original = s.fit === 'original';
  return (
    <div
      className={['hp-strip', original && 'hp-strip--original', feed && 'hp-strip--feed'].filter(Boolean).join(' ')}
      style={{
        maxWidth: original || zoom > 1 ? 'none' : width,
        width: zoom > 1 ? `calc(min(100%, ${width}px) * ${zoom})` : undefined,
        gap: s.gap,
        filter: s.brightness !== 100 ? `brightness(${s.brightness}%)` : undefined,
      }}
    >
      {content.pages.map((p, i) => (
        <StripImg key={p.id} url={p.url(s.quality)} i={i} eager={i < 3} original={original} nearness={nearness} />
      ))}
    </div>
  );
}

export function PagedView({
  content,
  page,
  s,
  onZone,
}: {
  content: Images;
  page: number;
  s: ReaderSettings['manga'];
  /** -1 — назад, 1 — вперед, 0 — середина (показати/сховати панелі). */
  onZone: (dir: -1 | 0 | 1) => void;
}) {
  const cur = content.pages[page];

  // Попереднє завантаження наступних сторінок.
  useEffect(() => {
    for (const p of content.pages.slice(page + 1, page + 4)) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = p.url(s.quality);
    }
  }, [content, page, s.quality]);

  const zone = (e: MouseEvent<HTMLElement>, el: HTMLElement) => {
    // Лише видима частина (сторінка може бути вищою за екран).
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const h = Math.max(1, Math.min(r.bottom, window.innerHeight) - top);
    onZone(tapZone(s.tapScheme, (e.clientX - r.left) / r.width, (e.clientY - top) / h, s.rtl));
  };


  const fitCls = s.fit === 'height' ? 'hp-page--fit-height' : s.fit === 'width' ? 'hp-page--fit-width' : '';
  return (
    <div
      className={`hp-page ${fitCls}`}
      onClick={s.clickArea === 'screen' ? (e) => zone(e, e.currentTarget) : undefined}
      style={{ filter: s.brightness !== 100 ? `brightness(${s.brightness}%)` : undefined }}
    >
      {cur && (
        <img
          key={cur.id}
          src={cur.url(s.quality)}
          alt={`Сторінка ${page + 1}`}
          referrerPolicy="no-referrer"
          style={s.fit === 'width' ? { maxWidth: s.width } : undefined}
          onClick={
            s.clickArea === 'image'
              ? (e) => {
                  e.stopPropagation();
                  zone(e, e.currentTarget);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
