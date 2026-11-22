/*
 * Компоненти в стилі Hikka (аналоги hikka-next/components/ui): Button, Select, Switch, Slider,
 * Tabs (сегменти), ChipTabs (плашки з числом), Header, Checkbox. Еталон — claude/hikka-ui-reference.md.
 * Кольори, радіус і тема — лише зі змінних сайту, бо користувач Hikka сам обирає акцент, радіус і тему.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Тема сайту (світла / темна) ---------- */

const darkStore = (() => {
  const subs = new Set<() => void>();
  let obs: MutationObserver | null = null;
  return {
    get: () => document.documentElement.classList.contains('dark'),
    subscribe(cb: () => void) {
      subs.add(cb);
      if (!obs) {
        obs = new MutationObserver(() => subs.forEach((f) => f()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      }
      return () => {
        subs.delete(cb);
        if (!subs.size) {
          obs?.disconnect();
          obs = null;
        }
      };
    },
  };
})();

/** Обгортка кожного нашого Shadow DOM: клас hp-dark, коли на Hikka темна тема. */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const dark = useSyncExternalStore(darkStore.subscribe, darkStore.get);
  return <div className={cx('hp-root', dark && 'hp-dark')}>{children}</div>;
}

/* ---------- Button ---------- */

export type BtnVariant = 'default' | 'secondary' | 'outline' | 'ghost';
export type BtnSize = 'lg' | 'md' | 'sm' | 'xs';

export const btn = (variant: BtnVariant = 'secondary', size: BtnSize = 'md', icon = false, extra?: string) =>
  cx('hp-btn', `hp-btn--${variant}`, `hp-btn--${size}`, icon && 'hp-btn--icon', extra);

export function Button({
  variant,
  size,
  icon,
  className,
  type = 'button',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; icon?: boolean }) {
  return <button type={type} className={btn(variant, size, icon, className)} {...p} />;
}

/* ---------- Header (заголовок блоку) ---------- */

export function Header({ title, count, children }: { title: ReactNode; count?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hp-header">
      <h2 className="hp-header__title">
        {title}
        {count != null && <span className="hp-header__count">{count}</span>}
      </h2>
      {children && <div className="hp-header__actions">{children}</div>}
    </div>
  );
}

/* ---------- Checkbox (лише вигляд) ---------- */

export const Check = ({ on }: { on: boolean }) => (
  <span className="hp-check" data-on={on || undefined} aria-hidden="true">
    {on && (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )}
  </span>
);

/* ---------- Tabs: сегментований перемикач ---------- */

export function Tabs<T extends string | boolean>({
  value,
  options,
  onChange,
  size,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  size?: 'sm';
  label?: string;
}) {
  return (
    <div className={cx('hp-tabs', size === 'sm' && 'hp-tabs--sm')} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          className="hp-tabs__item"
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* ---------- ChipTabs: плашки-фільтри з числом ---------- */

export type Chip = { value: string; label: string; count?: ReactNode; off?: boolean; title?: string };

export function ChipTabs({
  options,
  value,
  onPick,
  label,
  extra,
}: {
  options: Chip[];
  value: string | null;
  onPick: (v: string) => void;
  label: string;
  /** Елемент після ряду (поза прокруткою, щоб його список не обрізався), напр. ChipMenu. */
  extra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Активну плашку тримаємо у видимій частині ряду (лише по горизонталі).
  useEffect(() => {
    const row = ref.current;
    const a = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !a) return;
    const r = row.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    if (ar.right > r.right) row.scrollLeft += ar.right - r.right + 8;
    else if (ar.left < r.left) row.scrollLeft -= r.left - ar.left + 8;
  }, [value]);
  // Затухання країв — лише коли ряд справді не вміщується і з того боку є що прокрутити.
  const [fade, setFade] = useState({ l: false, r: false });
  const [bar, setBar] = useState({ w: 100, x: 0 }); // бігунок повзунка, % ширини доріжки
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const upd = () => {
      const l = row.scrollLeft > 1;
      const r = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setFade((f) => (f.l === l && f.r === r ? f : { l, r }));
      const w = (row.clientWidth / Math.max(1, row.scrollWidth)) * 100;
      const x = (row.scrollLeft / Math.max(1, row.scrollWidth)) * 100;
      setBar((b) => (Math.abs(b.w - w) < 0.1 && Math.abs(b.x - x) < 0.1 ? b : { w, x }));
    };
    // Колесо миші гортає ряд убік; на краю ряду прокрутка йде сторінці.
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 1) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      if ((dy < 0 && row.scrollLeft <= 0) || (dy > 0 && row.scrollLeft >= max - 1)) return;
      e.preventDefault();
      row.scrollLeft += dy;
    };
    upd();
    row.addEventListener('scroll', upd, { passive: true });
    row.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(upd);
    ro.observe(row);
    return () => {
      row.removeEventListener('scroll', upd);
      row.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [options.length]);
  // Перетягування бігунка: зсув миші → пропорційний зсув ряду.
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const row = ref.current;
    const track = e.currentTarget.parentElement;
    if (!row || !track) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.dataset.drag = '';
    const x0 = e.clientX;
    const s0 = row.scrollLeft;
    const k = row.scrollWidth / track.clientWidth;
    const move = (m: PointerEvent) => {
      row.scrollLeft = s0 + (m.clientX - x0) * k;
    };
    const up = () => {
      delete el.dataset.drag;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  // Клік по доріжці — гортаємо майже на ширину ряду в той бік.
  const jump = (e: ReactPointerEvent<HTMLDivElement>) => {
    const row = ref.current;
    if (!row) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dir = ((e.clientX - r.left) / r.width) * 100 < bar.x ? -1 : 1;
    row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <div className="hp-chipbox">
      <div className="hp-chiprow">
      <div ref={ref} className={cx('hp-chips', (fade.l || fade.r) && 'hp-chips--over', fade.l && 'hp-chips--fade-l', fade.r && 'hp-chips--fade-r')} role="tablist" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={o.value === value}
            className={cx('hp-chip', o.off && 'hp-chip--off')}
            title={o.title}
            onClick={() => onPick(o.value)}
          >
            {o.label}
            {o.count != null && o.count !== '' && <span className="hp-chip__count">{o.count}</span>}
          </button>
        ))}
      </div>
        {extra}
      </div>
      {(fade.l || fade.r) && (
        <div className="hp-hscroll" aria-hidden="true" onPointerDown={jump}>
          <div className="hp-hscroll__thumb" style={{ left: `${bar.x}%`, width: `${bar.w}%` }} onPointerDown={drag} />
        </div>
      )}
    </div>
  );
}

/* ---------- Switch ---------- */

export function Switch({
  checked,
  onChange,
  id,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  label?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="hp-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="hp-switch__thumb" />
    </button>
  );
}

/** Рядок налаштування як у Hikka: назва й опис ліворуч, перемикач праворуч. */
export function SwitchRow(p: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="hp-setrow">
      <label className="hp-setrow__text" htmlFor={id}>
        <span className="hp-setrow__label">{p.label}</span>
        {p.hint && <span className="hp-setrow__hint">{p.hint}</span>}
      </label>
      <Switch id={id} checked={p.checked} onChange={p.onChange} />
    </div>
  );
}

/* ---------- Slider ---------- */

export function Slider(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const fill = ((p.value - p.min) / (p.max - p.min)) * 100;
  return (
    <div className="hp-field">
      <div className="hp-field__head">
        <label className="hp-setrow__label" htmlFor={id}>
          {p.label}
        </label>
        <span className="hp-field__value">{p.format ? p.format(p.value) : p.value}</span>
      </div>
      <input
        id={id}
        className="hp-slider"
        type="range"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={p.value}
        style={{ '--hp-fill': `${fill}%` } as CSSProperties}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Підпис над елементом (Tabs, Select). */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="hp-field">
      <div className="hp-setrow__text">
        <span className="hp-setrow__label">{label}</span>
        {hint && <span className="hp-setrow__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ---------- Select (свій popover замість системного списку) ---------- */

export type Option<T extends string> = { value: T; label: string; hint?: string };

export function Select<T extends string>({
  value,
  options,
  onChange,
  title,
  size = 'md',
  className,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  title?: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const cur = options.find((o) => o.value === value);

  const show = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      setUp(below < 280 && r.top > below);
    }
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  // Закриття кліком поза списком: і всередині нашого Shadow DOM, і на сторінці.
  useEffect(() => {
    if (!open || !wrap.current) return;
    const root = wrap.current.getRootNode() as Document | ShadowRoot;
    const inside = (e: Event) => wrap.current?.contains(e.target as Node);
    const onRoot = (e: Event) => !inside(e) && setOpen(false);
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && setOpen(false);
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
    };
  }, [open]);

  // Esc закриває список, навіть якщо фокус не на кнопці (Firefox/macOS не фокусує кнопку кліком).
  // Не зупиняємо подію: читалка сама пропускає Esc, поки список відкритий.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o.value);
    }
  };

  return (
    <div ref={wrap} className={cx('hp-select', className)}>
      <button
        type="button"
        className={cx('hp-input', 'hp-select__trigger', size === 'lg' && 'hp-input--lg')}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        title={title}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="hp-grow hp-ellipsis">{cur?.label ?? ''}</span>
        <svg className="hp-icon hp-select__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        </svg>
      </button>
      {open && (
        <div ref={list} id={id} className={cx('hp-popover', up && 'hp-popover--up')} role="listbox">
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={cx('hp-option', i === active && 'hp-option--active')}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <Check on={o.value === value} />
              <span className="hp-grow hp-ellipsis">{o.label}</span>
              {o.hint && <span className="hp-option__hint">{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- ChipMenu (плашка зі списком, напр. «Ще 6») ---------- */

export type MenuItem = { value: string; label: string; hint?: string; title?: string };

export function ChipMenu({
  label,
  items,
  onPick,
  title,
}: {
  label: ReactNode;
  items: MenuItem[];
  onPick: (v: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  // Закриття кліком поза списком і клавішею Esc (як у Select).
  useEffect(() => {
    if (!open || !wrap.current) return;
    const root = wrap.current.getRootNode() as Document | ShadowRoot;
    const inside = (e: Event) => wrap.current?.contains(e.target as Node);
    const onRoot = (e: Event) => !inside(e) && setOpen(false);
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && setOpen(false);
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  const pick = (v: string) => {
    setOpen(false);
    onPick(v);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setActive(0);
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(items.length - 1, i + d)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = items[active];
      if (o) pick(o.value);
    }
  };

  return (
    <div ref={wrap} className="hp-menu">
      <button
        type="button"
        className="hp-chip hp-chip--off hp-chip--menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        title={title}
        onClick={() => {
          setActive(0);
          setOpen((v) => !v);
        }}
        onKeyDown={onKey}
      >
        {label}
        <svg className="hp-icon hp-chip__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id={id} className="hp-popover hp-popover--end" role="menu">
          {items.map((o, i) => (
            <div
              key={o.value}
              role="menuitem"
              title={o.title}
              className={cx('hp-option', i === active && 'hp-option--active')}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              <span className="hp-grow hp-ellipsis">{o.label}</span>
              {o.hint && <span className="hp-option__hint">{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Progress ---------- */

export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <div className={cx('hp-progress', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);
