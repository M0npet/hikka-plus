import DOMPurify from 'dompurify';
import { useEffect, useMemo, type MouseEvent } from 'react';
import type { ReaderSettings } from '../../core/store';
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

export function StripView({ content, s }: { content: Images; s: ReaderSettings['manga'] }) {
  return (
    <div
      className="hp-strip"
      style={{
        maxWidth: s.fit === 'original' ? 'none' : s.width,
        gap: s.gap,
        filter: s.brightness !== 100 ? `brightness(${s.brightness}%)` : undefined,
      }}
    >
      {content.pages.map((p, i) => (
        <img
          key={p.id}
          src={p.url(s.quality)}
          alt={`Сторінка ${i + 1}`}
          loading={i < 3 ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          decoding="async"
          data-page={i}
          style={s.fit === 'original' ? { width: 'auto', maxWidth: '100vw' } : undefined}
          onLoad={(e) => (e.currentTarget.dataset.loaded = '1')}
        />
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
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    let dir: -1 | 0 | 1 = x < 0.33 ? -1 : x > 0.67 ? 1 : 0;
    if (s.rtl && dir !== 0) dir = (dir * -1) as -1 | 1;
    onZone(dir);
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
