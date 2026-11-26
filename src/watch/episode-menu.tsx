/** Меню серій у лівій панелі поверх плеєра (MK 2026-11-26 13:39: окремо, посторінково; винесено з watch-block.tsx, бэклог 2d). */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/kit';
import { IconEye, IconEyeOff, IconLeft, IconRight } from '../ui/icons';
import { EP_KIND_INFO, type EpKind, type EpKinds } from './fillers';
import { type EpisodeState } from './types';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Підказка клітинки серії: «Серія N: Назва — стан». */
export function epHint(n: number, title: string | undefined, state: string, kind?: EpKind) {
  return `Серія ${n}${kind ? ` (${EP_KIND_INFO[kind][0].toLowerCase()})` : ''}${title ? `: ${title}` : ''}${state ? ` — ${state}` : ''}`;
}
/** Кольорова риска типу серії під номером (як у Mikai). */
export const epType = (k?: EpKind) => (k ? <span className={`hp-watch__eptype hp-watch__eptype--${k}`} aria-hidden="true" /> : null);

/** Серій на сторінці меню (6 × 4). */
const EP_PAGE = 24;

export function EpisodeMenu({
  ep,
  count,
  episodes,
  titles,
  kinds,
  teamHas,
  onPick,
  onOpen,
  canUnwatch,
  onMark,
  onUnwatch,
}: {
  ep: number;
  count: number;
  episodes: Record<number, EpisodeState>;
  titles?: Record<number, string>;
  kinds?: EpKinds;
  teamHas: (n: number) => boolean;
  onPick: (n: number) => void;
  onOpen?: (open: boolean) => void;
  canUnwatch?: (n: number) => boolean;
  onMark?: (n: number) => void;
  onUnwatch?: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  // Режим «Відмічати» (MK 2026-11-26 15:28): клік по серії — переглянуто / зняти відмітку, меню не закривається.
  const [marking, setMarking] = useState(false);
  const pages = Math.max(1, Math.ceil(count / EP_PAGE));
  const [page, setPage] = useState(0);
  /** Серія під курсором — її назва в рядку під сіткою (інакше — поточної). */
  const [hover, setHover] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => onOpenRef.current?.(open), [open]);
  // Відкрили — сторінка з поточною серією.
  useEffect(() => {
    if (open) setPage(Math.min(pages - 1, Math.floor((ep - 1) / EP_PAGE)));
    setHover(0);
    setMarking(false);
  }, [open]);
  useEffect(() => {
    if (!open || !wrap.current) return;
    const root = wrap.current.getRootNode() as Document | ShadowRoot;
    const close = () => setOpen(false);
    const onRoot = (e: Event) => !wrap.current?.contains(e.target as Node) && close();
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        setPage((x) => Math.max(0, Math.min(pages - 1, x + (e.key === 'PageDown' ? 1 : -1))));
      }
    };
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close); // клік у сам плеєр (iframe)
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
    };
  }, [open, pages]);
  const from = page * EP_PAGE + 1;
  const to = Math.min(count, from + EP_PAGE - 1);
  return (
    <div ref={wrap} className="hp-select hp-watch__epmenu">
      <button
        type="button"
        className="hp-watch__tool hp-watch__tool--ep"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={titles?.[ep] ? `Серія ${ep}: ${titles[ep]}` : 'Вибрати серію'}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Пробіли — нерозривні: у кнопці-flex звичайний пробіл на межі шматків тексту зникає («Серія11/ 16»). */}
        <span className="hp-watch__toolword">Серія{' '}</span>
        {ep}
        <span className="hp-watch__toolof">{' '}/ {count}</span>
      </button>
      {open && (
        <div className="hp-popover hp-watch__eppop" role="dialog" aria-label="Серії">
          <div className="hp-watch__eppage">
            {pages > 1 ? (
              <>
                <Button variant="ghost" size="sm" icon aria-label="Попередні серії" title="Попередні (PgUp)" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                  <IconLeft />
                </Button>
                <span className="hp-watch__eppagetext">
                  {from}–{to} <span className="hp-header__count">з {count}</span>
                </span>
                <Button variant="ghost" size="sm" icon aria-label="Наступні серії" title="Наступні (PgDn)" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  <IconRight />
                </Button>
              </>
            ) : (
              <span className="hp-watch__eppagetext">
                Серії <span className="hp-header__count">{count}</span>
              </span>
            )}
            {onMark && (
              <button
                type="button"
                className="hp-watch__epmark"
                aria-pressed={marking}
                title={marking ? 'Готово — клік по серії знову відкриває її' : 'Клік по серії — позначити переглянутою або зняти відмітку'}
                onClick={() => setMarking((x) => !x)}
              >
                {marking ? <IconEye /> : <IconEyeOff />}
                {marking ? 'Готово' : 'Відмічати'}
              </button>
            )}
          </div>
          <div className="hp-watch__epgrid" role="list">
            {Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => {
              const n = from + i;
              const s = episodes[n];
              const seen = !!s?.watched;
              const lock = seen && !canUnwatch?.(n);
              return (
                <button
                  key={n}
                  type="button"
                  role="listitem"
                  className={cx('hp-watch__epcell', n === ep && 'hp-watch__epcell--on', seen && 'hp-watch__epcell--seen', marking && 'hp-watch__epcell--marking')}
                  disabled={marking ? lock || !(teamHas(n) || seen) : !teamHas(n)}
                  aria-current={n === ep || undefined}
                  aria-pressed={marking ? seen : undefined}
                  title={
                    marking
                      ? lock
                        ? 'Зарахована в списку Hikka. Щоб зняти — «−» у віджеті Hikka або «Відмічати в Hikka».'
                        : seen
                          ? `Зняти відмітку з серії ${n}`
                          : `Позначити серію ${n} переглянутою`
                      : epHint(n, titles?.[n], !teamHas(n) ? 'ще немає в цієї команди' : seen ? 'переглянуто' : s?.pos ? `${Math.round(s.pos * 100)}%` : '', kinds?.[n])
                  }
                  onPointerEnter={() => setHover(n)}
                  onPointerLeave={() => setHover(0)}
                  onFocus={() => setHover(n)}
                  onClick={() => {
                    if (marking) return void (seen ? onUnwatch?.(n) : onMark?.(n));
                    setOpen(false);
                    if (n !== ep) onPick(n);
                  }}
                >
                  {n}
                  {epType(kinds?.[n])}
                  {!seen && s?.pos ? <span className="hp-watch__epbar" style={{ width: `${s.pos * 100}%` }} /> : null}
                </button>
              );
            })}
          </div>
          {titles?.[hover || ep] ? (
            <div className="hp-watch__epline" aria-live="polite">
              <b>{hover || ep}.</b> {titles[hover || ep]}
            </div>
          ) : null}
          {pages > 1 && pages <= 12 && (
            <div className="hp-watch__epdots" role="tablist" aria-label="Сторінки серій">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === page}
                  className="hp-watch__epdot"
                  title={`${i * EP_PAGE + 1}–${Math.min(count, (i + 1) * EP_PAGE)}`}
                  onClick={() => setPage(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
