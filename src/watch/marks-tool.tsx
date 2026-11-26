/** Кнопка «Мітки» на правій панелі поверх плеєра (з watch-block.tsx, бэклог 2d). */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/kit';
import { IconFlag } from '../ui/icons';
import type { MarkSrc } from './skip-marks';
import type { MarksInfo } from './watch-root';

const SRC_NAMES: Record<MarkSrc, string> = { player: 'з плеєра', aniskip: 'AniSkip, приблизно' };
const KIND_NAMES = { op: 'Опенінг', ed: 'Ендинг' } as const;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Кнопка «Мітки» на правій панелі поверх плеєра (MK 2026-11-26 17:18, замість смужки під плеєром): наведення або дотик —
 *  з якого по який час опенінг і ендинг і звідки мітки; клік по рядку — перейти на початок. */
export function MarksTool({ info, onSeek, onOpen }: { info: MarksInfo; onSeek: (sec: number) => void; onOpen: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const entered = useRef(0);
  const set = (on: boolean) => {
    clearTimeout(timer.current);
    setOpen(on);
    onOpen(on);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const m = info.m;
  const kinds = (['op', 'ed'] as const).filter((k) => m[k]);
  return (
    <div
      className="hp-select hp-watch__markstool"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        entered.current = Date.now();
        set(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => set(false), 200);
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        icon
        className="hp-watch__tool"
        aria-label="Мітки опенінгу й ендингу"
        aria-expanded={open}
        // Мишею відкриває наведення — клік одразу після нього не закриває; на дотик — клік відкриває/закриває.
        onClick={() => Date.now() - entered.current > 400 && set(!open)}
      >
        <IconFlag />
      </Button>
      {open && (
        <div className="hp-popover hp-popover--end hp-watch__markpop" role="dialog" aria-label="Мітки">
          {kinds.map((k) => (
            <button key={k} type="button" className="hp-watch__mark" onClick={() => onSeek(m[k]!.s)} title={`Перейти на початок: ${KIND_NAMES[k].toLowerCase()}`}>
              <span className={`hp-watch__dot hp-watch__dot--${k}`} />
              <span className="hp-watch__markname">{KIND_NAMES[k]}</span>
              <span className="hp-watch__marktime">
                {fmt(m[k]!.s)}–{fmt(m[k]!.e)}
              </span>
              <span className="hp-watch__marksrc">{SRC_NAMES[m[k]!.src]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
