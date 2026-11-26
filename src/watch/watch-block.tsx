/*
 * Блок «Перегляд» на сторінці аніме (між «Опис» і «Головні персонажі»).
 * Команда → плеєр → iframe самого плеєра; озвучка, серія і плеєр — на панелі поверх відео (Dawn прибрано, MK 15:28).
 * «Ширше» — увесь блок на ширину сітки сторінки (wide-layout.ts); блок не переїжджає в DOM, iframe не перезавантажується.
 */
import { cloneElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Button, Check, ChipTabs, Header, SwitchRow, btn } from '../ui/kit';
import { IconExpand, IconExternal, IconEye, IconEyeOff, IconHeart, IconLeft, IconRight, IconSettings, IconShrink, IconTv, IconBulb, IconClose, IconFwd, IconSkipFwd, IconMoveH, IconMoveV, IconMoveBack, IconScan } from '../ui/icons';
import { useLightsOff } from './lights-off';
import { useWideLayout } from './wide-layout';
import { EP_KIND_INFO, type EpKinds } from './fillers';
import { AMBIENT_REQ, PLAYER_NAMES, SITE_NAMES, teamEpisodes, type EdInfo, type EpisodeState, type WatchPlayer, type WatchTeam } from './types';
import { DEFAULT_AMBIENT_BRIGHT, DEFAULT_AMBIENT_LEVEL, DEFAULT_MENU_LEVEL, DEFAULT_WIDE_ANIM, NEXT_COUNTDOWN, type WatchPrefs, type WatchSize } from './watch-store';
import { AmbientFields, MenuOpacityField } from './ambient-fields';
import type { Seg } from './skip-marks';
import type { UaLicense } from './providers';
import type { MarksInfo } from './watch-root';
import { EpisodeMenu, epHint, epType } from './episode-menu';
import { MarksTool } from './marks-tool';
import { PlayerFrame, type BarSeg } from './player-iframe';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const RANGE = 50;
/** Через скільки мс без руху миші ховається панель кнопок поверх плеєра (як курсор, player-frame idleCursor). */
const TOOLS_IDLE = 2500;

export type HikkaLine = { kind: 'count'; n: number } | { kind: 'connect'; onClick: () => void } | { kind: 'error'; message: string } | null;

type WatchBlockProps = {
  status: 'loading' | 'ready' | 'not-found';
  error?: string;
  teams: WatchTeam[];
  /** Стан серій за номером. */
  episodes: Record<number, EpisodeState>;
  /** Назви серій з Hikka (`/anime/{slug}/episodes`) за номером. */
  epTitles?: Record<number, string>;
  /** Типи серій з Mikai (fillers.ts): канон аніме / змішаний / філер — у сітці й меню серій. */
  epKinds?: EpKinds;
  /** Наступний сезон (Hikka franchise): кнопка поверх плеєра на останній серії замість «Наступна серія». */
  /** list — це не сезон, а «Далі з Дивлюсь» (up-next.ts): номер серії, з якої продовжити. */
  sequel?: { slug: string; title: string; soon: boolean; list?: number } | null;
  onSequel?: (slug: string) => void;
  /** Серій за Hikka (сітка показує й ще не додані на сайти). */
  total?: number;
  hikka?: HikkaLine;
  /** Українська ліцензія з Mikai: де дивитися легально (кнопка в шапці; без серій — замість «не знайшли»). */
  license?: UaLicense;
  /** Поріг зарахування поточної серії: at — секунда, ed — це початок ендингу (а не приблизний поріг без міток). */
  edInfo?: EdInfo | null;
  prefs: WatchPrefs;
  onPrefs: (p: Partial<WatchPrefs>) => void;
  /** Куди переносити плеєр у режимі «Ширше» (host над колонками сторінки). */
  /** Останній вибір і позиція (зі сховища). */
  initial?: { team?: string; player?: string; ep?: number; t?: number };
  /** Поточна секунда (для повернення після перезавантаження iframe). */
  resumeAt?: () => number;
  /** Перша непереглянута серія після останньої переглянутої (Hikka або наші відмітки). */
  nextEp?: number;
  /** Чи можна зняти відмітку «переглянуто» з серії (лічильник Hikka — лише з дозволом на запис). */
  canUnwatch?: (ep: number) => boolean;
  onUnwatch?: (ep: number) => void;
  /** Відмітити серію переглянутою вручну (глазок у сітці). */
  onMark?: (ep: number) => void;
  onSelect?: (s: { team: string; player: string; ep: number }) => void;
  onTime?: (ep: number, t: number, duration: number) => void;
  onSegs?: (ep: number, segs: { op?: Seg; ed?: Seg }) => void;
  onEnded?: (ep: number) => void;
  /** Мітки OP/ED поточної серії (watch-root: плеєр → AniSkip). */
  marks?: MarksInfo | null;
  /** Вміст рамки замість iframe (стенд). */
  renderFrame?: (p: WatchPlayer, ep: number) => ReactNode;
};

/* ---------- Список із багатим пунктом (Команда / Плеєр) ---------- */

function Picker<T>({
  items,
  value,
  keyOf,
  trigger,
  item,
  onPick,
  label,
  className,
  triggerClass,
  onOpen,
}: {
  items: T[];
  value: T | undefined;
  keyOf: (t: T) => string;
  trigger: ReactNode;
  item: (t: T) => ReactNode;
  onPick: (t: T) => void;
  label: string;
  className?: string;
  /** Свій вигляд кнопки замість поля Hikka (панель поверх плеєра). */
  triggerClass?: string;
  /** Список відкрився/закрився (панель поверх плеєра не ховається, поки він відкритий). */
  onOpen?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => onOpenRef.current?.(open), [open]);
  useEffect(() => {
    if (!open || !wrap.current) return;
    const root = wrap.current.getRootNode() as Document | ShadowRoot;
    const onRoot = (e: Event) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && setOpen(false);
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);
  return (
    <div ref={wrap} className={cx('hp-select', className)}>
      <button
        type="button"
        className={triggerClass ?? 'hp-input hp-input--lg hp-select__trigger'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {triggerClass ? trigger : <span className="hp-grow hp-watch__trig">{trigger}</span>}
        <svg className="hp-icon hp-select__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 15 5 5 5-5" />
          <path d="m7 9 5-5 5 5" />
        </svg>
      </button>
      {open && (
        <div className="hp-popover hp-watch__pop" role="listbox" aria-label={label}>
          {items.map((t) => {
            const on = !!value && keyOf(t) === keyOf(value);
            return (
              <div
                key={keyOf(t)}
                role="option"
                aria-selected={on}
                className="hp-option hp-watch__opt"
                onClick={() => {
                  onPick(t);
                  setOpen(false);
                }}
              >
                <Check on={on} />
                {item(t)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const Avatar = ({ t }: { t: WatchTeam }) => {
  const [bad, setBad] = useState(false);
  return t.avatar && !bad ? (
    <img className="hp-watch__ava" src={t.avatar} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBad(true)} />
  ) : (
    <span className="hp-watch__ava" aria-hidden="true">
      {t.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()}
    </span>
  );
};

const TeamLine = ({ t, full }: { t: WatchTeam; full?: boolean }) => (
  <>
    <Avatar t={t} />
    <span className="hp-grow hp-ellipsis">{t.name}</span>
    <span className={cx('hp-watch__kind', t.sub && 'hp-watch__kind--sub')}>{t.sub ? 'Субтитри' : 'Озвучка'}</span>
    {full && <span className="hp-option__hint">{teamEpisodes(t)} еп.</span>}
  </>
);

/* ---------- Сам блок ---------- */

export function WatchBlock(p: WatchBlockProps) {
  const init = p.initial;
  const [teamId, setTeamId] = useState<string | undefined>(init?.team);
  const [playerId, setPlayerId] = useState<string | undefined>(init?.player);
  const [ep, setEp] = useState(init?.ep && init.ep > 0 ? init.ep : 1);
  // Серія, з якою завантажено iframe. Fenix сам перемикає серії у своєму списку — тоді міняємо лише ep (сітка, лічильник),
  // а iframe не перезавантажуємо.
  const [frameEp, setFrameEp] = useState(ep);
  const selfSwitch = useRef(0);
  const picked = useRef(false); // серію вже вибрано (користувачем або автоматично) — не перестрибувати

  const [wide, setWide] = useState(!!p.prefs.wide);
  const [menu, setMenu] = useState(false);
  const [marksOpen, setMarksOpen] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  // Меню налаштувань закривається кліком поза ним, Esc і кліком у плеєр (iframe забирає фокус — у вікна blur).
  useEffect(() => {
    if (!menu || !menuWrap.current) return;
    const root = menuWrap.current.getRootNode() as Document | ShadowRoot;
    const close = () => setMenu(false);
    const onRoot = (e: Event) => !menuWrap.current?.contains(e.target as Node) && close();
    const onDoc = (e: Event) => root instanceof ShadowRoot && e.target !== root.host && close();
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    root.addEventListener('pointerdown', onRoot, true);
    if (root !== document) document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onEsc, true);
    window.addEventListener('blur', close);
    return () => {
      root.removeEventListener('pointerdown', onRoot, true);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  // Панель кнопок поверх плеєра (MK 2026-11-26 13:22, «перенести в плеєри»): видно, поки миша рухається в плеєрі
  // (фрейм шле {active}), і ще TOOLS_IDLE мс; поки миша на самій панелі або відкрите меню — не ховаємо.
  const [tools, setTools] = useState(false);
  // Відстань від низу блоку до верху панелі самого плеєра (px) — кнопки «Пропустити»/«Наступна серія» стоять над нею,
  // коли панель видно, і опускаються, коли плеєр її сховав (MK 2026-11-26 17:32). null — ще не знаємо (місце з CSS).
  const [uiB, setUiB] = useState<number | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [epOpen, setEpOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const toolsT = useRef(0);
  const toolsHover = useRef(false);
  const wakeTools = (on: boolean) => {
    // Миша вийшла з плеєра — не ховаємо одразу (MK 2026-11-26 15:41: меню «резко пропадает и появляется»): часто це
    // перехід на нашу ж панель, а прихована панель (pointer-events: none) не ловить мишу — вона знову в плеєрі → {active: 1}
    // → панель видно → … Ховаємо, як і без руху, через TOOLS_IDLE після останньої активності.
    if (!on) return;
    clearTimeout(toolsT.current);
    setTools(true);
    toolsT.current = window.setTimeout(() => !toolsHover.current && setTools(false), TOOLS_IDLE);
  };
  useEffect(() => () => clearTimeout(toolsT.current), []);
  // Миша на наших панелях/кнопках поверх плеєра — для самого плеєра вона «вийшла», і він ховає свою панель
  // (MK 2026-11-26 15:26). Поки миша на нашому — раз на секунду просимо фрейм {hold}: там імітують рух миші по плеєру.
  const holdT = useRef(0);
  const holdPing = () => {
    const f = frameRef.current?.querySelector('iframe');
    if (!f?.src) return;
    try {
      f.contentWindow?.postMessage({ type: AMBIENT_REQ, hold: 1 }, new URL(f.src).origin);
    } catch {
      /* ще about:blank або фрейм прибрано */
    }
  };
  // Не за pointerenter/leave окремих панелей (MK 15:48: «пропустил рамки, ограничения кнопок»): pointerover/move на всьому
  // блоці плеєра (.hp-watch__view) — миша на будь-якому нашому елементі (рамка, проміжок, кнопка, меню) → {hold}.
  // Відпускаємо, коли фрейм каже про СПРАВЖНІЙ рух миші в самому плеєрі ({active: 1}; перехід у iframe hikka.io бачить
  // не завжди, особливо на заокруглених краях) або миша вийшла з блоку.
  const holding = useRef(false);
  const pingAt = useRef(0);
  /** Плеєр міг уже побачити mouseleave і сховати панель (MK 16:06: на лінії в 1 px панель Fenix «пропадает сразу») —
   *  кажемо одразу, а не чекаємо тику: на pointerover (now) не частіше ніж раз на 100 мс, на рух — раз на 300 мс
   *  (повернення з iframe браузер часто дає лише pointermove, без pointerover). */
  const holdOn = (now = false, force = false) => {
    if (holding.current) {
      if (force || Date.now() - pingAt.current > (now ? 100 : 300)) {
        pingAt.current = Date.now();
        holdPing();
      }
      return;
    }
    holding.current = true;
    pingAt.current = Date.now();
    holdPing();
    holdT.current = window.setInterval(holdPing, 1000);
  };
  const holdOff = () => {
    holding.current = false;
    clearInterval(holdT.current);
  };
  useEffect(() => holdOff, []);
  // Миша вийшла з кадру ({active: 0}). Повернення з iframe на наш елемент браузер часто не повідомляє жодною подією
  // (ні pointerover, ні pointermove — перевірено в E2E, MK 16:06 «лінія в 1 px»), а :hover ставить правильно —
  // дивимося, що під мишею: наш елемент у блоці плеєра → тримаємо одразу; повторно через 60 мс (:hover міг ще не оновитись).
  // Без обмеження частоти (MK 2026-11-26 16:31, «с рамки на среднюю часть»): Firefox шле mouseleave у кадр запізно — коли
  // миша вже йде з рамки на кнопку, а наш пінг з рамки щойно був (< 100 мс) → пропускали, і Fenix стояв схованим до тику (1 с).
  // {active: 0} фрейм шле з того ж mouseleave, після якого плеєр ховає панель, тож цей пінг завжди приходить після нього.
  const holdIfOurs = () => {
    const check = () => {
      const view = viewRef.current;
      const root = view?.getRootNode() as ShadowRoot | Document | undefined;
      if (!view || !root) return;
      const hov = root.querySelectorAll(':hover');
      const last = hov[hov.length - 1];
      if (last && last.tagName !== 'IFRAME' && view.contains(last)) holdOn(true, true);
    };
    check();
    window.setTimeout(check, 60);
  };
  // Відео ще не пустили або пауза (MK 2026-11-26 15:41: «когда я еще не нажимал на плеер, наше меню тоже должно
  // показываться») — панелі видно весь час, як і панель самого плеєра. «Стоїть» = позиція не мінялася 1,5 с.
  // Без інтервалу (бэклог 2c): кожна нова позиція перезапускає таймер, тож поки відео стоїть, ніщо не прокидається.
  const tick = useRef({ t: -1, timer: 0 });
  const [still, setStill] = useState(true);
  const moved = (t: number) => {
    if (t === tick.current.t) return;
    tick.current.t = t;
    setStill(false);
    clearTimeout(tick.current.timer);
    tick.current.timer = window.setTimeout(() => setStill(true), 1500);
  };
  useEffect(() => () => clearTimeout(tick.current.timer), []);
  const [range, setRange] = useState('0');
  // З якої секунди почати після (пере)завантаження iframe.
  const startAt = useRef(init?.t ?? 0);
  // Поточна позиція (крок 1 с) — у маленькому сховищі, без перемальовування блоку: блок (сітка серій, меню) —
  // лише коли кнопка «Пропустити» з'являється/зникає.
  const posStore = useMemo(createPosStore, []);
  const [skip, setSkip] = useState<(SkipState & { ep: number }) | null>(null);
  // «Наступна серія» поверх плеєра (MK 2026-11-26): з порогу зарахування (початок ендингу) до кінця серії.
  // left — секунд до самостійного переходу (лише з WatchPrefs.nextCountdown; рахуємо за позицією відео — пауза зупиняє відлік).
  const [next, setNext] = useState<{ ep: number; left: number | null } | null>(null);
  // «Наступний сезон ▶» — з порогу зарахування останньої серії сезону (за Hikka), якщо в тайтлу є продовження.
  const [season, setSeason] = useState(0);
  const nextT0 = useRef(new Map<number, number>());
  const nextOff = useRef(new Set<number>());
  const nextFired = useRef(new Set<number>());
  const edRef = useRef<EdInfo | null>(null);
  edRef.current = p.edInfo ?? null;
  const mkRef = useRef<MarksInfo | null>(null);
  const seekRef = useRef<((sec: number) => void) | null>(null);
  const skipped = useRef(new Set<string>());
  const frameRef = useRef<HTMLDivElement>(null);
  // Повний екран — уся .hp-watch__view (рамка + підсвітка): на широкому екрані краї світяться (MK 15:39, «як у телеків»).
  const viewRef = useRef<HTMLDivElement>(null);
  // Підсвітка: canvas за рамкою (поза .hp-watch__frame — та обрізає вміст).
  const [glowEl, setGlowEl] = useState<HTMLCanvasElement | null>(null);
  const ambient = p.prefs.ambient !== false;
  const marksOn = p.prefs.marks !== false;
  const stageRef = useRef<HTMLElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const [full, setFull] = useState(false);
  // «Вимкнути світло» — не запам'ятовуємо: щоразу вмикає сам користувач.
  const [dark, setDark] = useState(false);
  useLightsOff(viewRef, dark && !full, () => setDark(false));
  const canFull = typeof document !== 'undefined' && document.fullscreenEnabled !== false;

  const team = p.teams.find((t) => t.id === teamId) ?? p.teams[0];
  const players = useMemo(() => {
    const list = team?.players ?? [];
    // Улюблений плеєр — першим.
    return [...list].sort((a, b) => Number(b.kind === p.prefs.favPlayer) - Number(a.kind === p.prefs.favPlayer));
  }, [team, p.prefs.favPlayer]);
  const player = players.find((x) => x.id === playerId) ?? players[0];
  const dupKind = (x: WatchPlayer) => players.filter((y) => y.kind === x.kind).length > 1;
  const count = Math.max(team ? teamEpisodes(team) : 0, p.total ?? 0, ep);
  const has = (n: number) => !!player?.episodes.includes(n);
  /** Плеєр команди, у якому є серія n: поточний, інакше перший за порядком (улюблений — першим). */
  const playerFor = (n: number) => (has(n) ? player : players.find((x) => x.episodes.includes(n)));
  /** Серія є хоч в одному плеєрі команди (MK 15:26: у Moon до 16, а в команди 21 — серії мали вибиратися). */
  const teamHas = (n: number) => !!playerFor(n);

  useEffect(() => {
    setRange(String(Math.floor((ep - 1) / RANGE)));
  }, [ep]);
  useEffect(() => {
    if (team && player) p.onSelect?.({ team: team.id, player: player.id, ep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, player?.id, ep]);

  const goEp = (n: number) => {
    picked.current = true;
    // У поточного плеєра цієї серії немає — перемикаємося на плеєр команди, де вона є.
    const alt = playerFor(n);
    if (alt && player && alt.id !== player.id) setPlayerId(alt.id);
    if (n === ep && n === frameEp && (!alt || alt.id === player?.id)) return;
    startAt.current = 0;
    setEp(n);
    setFrameEp(n);
  };
  /** Плеєр сам перейшов на серію n (Fenix): лише відмічаємо, iframe лишається. */
  const playerEp = (n: number) => {
    if (n === ep || !has(n)) return;
    picked.current = true;
    selfSwitch.current = Date.now();
    startAt.current = 0;
    setEp(n);
  };
  // Інший плеєр/команда — вантажимо ту серію, яку зараз видно (після самоперемикання Fenix вона новіша за frameEp).
  useEffect(() => {
    setFrameEp(ep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, player?.id]);
  // Заходимо на тайтл: якщо поточна серія вже переглянута — стаємо на першу непереглянуту (лічильник Hikka
  // приходить не одразу). Лише доки користувач сам нічого не вибрав.
  useEffect(() => {
    const n = p.nextEp;
    if (picked.current || !n || n === ep || !player || !teamHas(n)) return;
    if (!p.episodes[ep]?.watched) return; // почата й не дограна — лишаємо
    picked.current = true;
    goEp(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.nextEp, player?.id]);
  const goEpRef = useRef(goEp);
  goEpRef.current = goEp;
  const canNextRef = useRef<(n: number) => boolean>(() => false);
  canNextRef.current = (n: number) => n < count && teamHas(n + 1);
  // Остання серія сезону — лише коли Hikka знає кількість серій (в онгоінгу команда може просто відставати).
  const seasonRef = useRef<(n: number) => boolean>(() => false);
  seasonRef.current = (n: number) => !!p.sequel && !!p.total && n >= p.total;
  const toggleWide = (v: boolean) => {
    // iframe не перезавантажується (блок не переїжджає в DOM, wide-layout.ts) — позицію не чіпаємо.
    setWide(v);
    p.onPrefs({ wide: v });
  };
  // «Ширше» — спільне для всіх тайтлів (налаштування могли дочитатися пізніше або змінитися у вікні налаштувань).
  useEffect(() => {
    if (p.prefs.wide === undefined) return;
    setWide(p.prefs.wide);
  }, [p.prefs.wide]);
  // Moon — завжди «Ширше» (MK 15:39): у вузькому блоці його панель блимає у Firefox (баг Moon), а рамка 420 px дає смуги.
  // Налаштування «Ширше» не змінюємо — для інших плеєрів лишається як вибрано. Якщо «Ширше» неможливе (вузьке вікно) —
  // Moon у звичайному блоці з рамкою 420 px.
  const [noWide, setNoWide] = useState(false);
  const moonWide = player?.kind === 'moon' && !wide && !noWide;
  const effWide = wide || moonWide;
  // Розмір плеєра в «Ширше» (як у Mikai, MK 2026-11-24): по колу «ширина сторінки» → «на всю ширину вікна» → «на всю висоту».
  // iframe не перезавантажується (wide-layout.ts лише перераховує позицію). Запам'ятовується між тайтлами.
  const [size, setSize] = useState<WatchSize>(p.prefs.size ?? 'grid');
  useEffect(() => {
    if (p.prefs.size) setSize(p.prefs.size);
  }, [p.prefs.size]);
  const effSize: WatchSize = effWide ? size : 'grid';
  const nextSize: WatchSize = size === 'grid' ? 'window' : size === 'window' ? 'screen' : 'grid';
  const SIZE_LABEL: Record<WatchSize, string> = { grid: 'За шириною сторінки', window: 'На всю ширину вікна', screen: 'На всю висоту вікна' };
  const fitScreen = () => {
    const v = viewRef.current;
    if (v) window.scrollTo({ top: Math.round(v.getBoundingClientRect().top + window.scrollY), behavior: 'smooth' });
  };
  useWideLayout(
    effWide,
    stageEl,
    () => {
      setWide(false);
      setNoWide(true);
    },
    p.prefs.wideAnim ?? DEFAULT_WIDE_ANIM,
    effSize,
    // На все вікно — плеєр рівно в екран (як у Mikai); після анімації, щоб рахувати від кінцевого місця.
    (sz) => sz === 'screen' && setTimeout(fitScreen, (p.prefs.wideAnim ?? DEFAULT_WIDE_ANIM) + 30),
  );
  // Після перемикання «Ширше» — прокрутити до плеєра.
  useEffect(() => {
    const t = setTimeout(() => stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
  }, [wide]);
  // Повний екран — рамка разом з iframe (сам iframe не перезавантажується, позиція й адаптер лишаються).
  useEffect(() => {
    const on = () => {
      const el = viewRef.current;
      setFull(!!el && (document.fullscreenElement === el || (el.getRootNode() as ShadowRoot).fullscreenElement === el));
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (full) return void document.exitFullscreen?.().catch(() => {});
    // Телефон/планшет (MK 2026-11-26 17:39: «сенсорные экраны, планшеты, андроид»): у повному екрані — альбомна орієнтація,
    // як у YouTube; працює в Firefox і Chrome на Android, на ПК і в iOS — тихо нічого. Повертає сам браузер на виході.
    void viewRef.current
      ?.requestFullscreen?.()
      .then(() => {
        if (!matchMedia('(pointer: coarse)').matches) return;
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.('landscape');
      })
      .catch(() => {});
  };

  // Мітки OP/ED: кнопка «Пропустити» поверх плеєра (і в повному екрані) та автопропуск, якщо ввімкнено.
  const mk = marksOn && p.marks && p.marks.ep === ep ? p.marks : null;
  mkRef.current = mk;
  const skipNow = mk && skip && skip.ep === ep ? skip : null;
  const nextNow = next && next.ep === ep ? next : null;
  const seasonNow = season === ep && p.sequel ? p.sequel : null;
  const goSeason = (to: string) => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    p.onSequel?.(to);
  };
  // Fenix з власними мітками сам показує «Пропустити OP/ED» і «Наступна серія» (там же, де наші) — дублів не малюємо;
  // клавіші S/N і автопропуск працюють як і раніше (MK 2026-11-26 13:44: «у феникса свои кнопки»).
  const fenixOwn = player?.kind === 'fenix' && (mk?.m.op?.src === 'player' || mk?.m.ed?.src === 'player');
  // Moon з власною міткою сам показує «Пропустити» над своєю панеллю (не сховати — параметра немає) — свою не дублюємо
  // (MK 2026-11-26 17:32: кнопки мають слідувати за інтерфейсом плеєра; у Moon його кнопка вже так уміє). Клавіша S і автопропуск — наші.
  const moonOwn = player?.kind === 'moon' && !!skipNow && mk?.m[skipNow.kind]?.src === 'player';
  const skipShow = !!skipNow && !fenixOwn && !moonOwn;
  const kindsHere = (['a', 'x', 'f'] as const).filter((k) => p.epKinds && Object.values(p.epKinds).includes(k));
  const overOn = skipShow || (!!nextNow && !fenixOwn) || !!seasonNow;
  // S / N у плеєрі (entrypoints/player-frame.content.ts → {hotkey}).
  const hotkeyRef = useRef<(key: 'skip' | 'next') => void>(() => {});
  hotkeyRef.current = (key) => {
    if (key === 'skip' && skipNow) doSkip(skipNow.kind, skipNow.seg.e);
    if (key === 'next' && ep < count && teamHas(ep + 1)) goEp(ep + 1);
    else if (key === 'next' && seasonNow) goSeason(seasonNow.slug);
  };
  /** Після ендингу ще є що дивитися (сцена після титрів / анонс) — тоді «Пропустити ендинг» веде туди. */
  const afterEd = (edEnd: number) => {
    const d = posStore.get()?.d ?? 0;
    return d > 0 && d - edEnd > 20;
  };
  const doSkip = (kind: 'op' | 'ed', to: number) => {
    skipped.current.add(`${ep}:${kind}`);
    seekRef.current?.(to);
  };
  useEffect(() => {
    if (!skipNow) return;
    const auto = skipNow.kind === 'op' ? p.prefs.skipOp : p.prefs.skipEd;
    // Сам — лише раз за серію і лише на початку шматка: якщо повернулися назад, щоб подивитися, — не заважаємо.
    const now = posStore.get();
    if (!auto || skipped.current.has(`${ep}:${skipNow.kind}`) || !now || now.ep !== ep || now.t > skipNow.seg.s + 3) return;
    doSkip(skipNow.kind, skipNow.seg.e);
  }, [skipNow?.kind, skipNow?.seg.s, ep]);

  if (p.status === 'loading')
    return (
      <section className="hp-section">
        <Header title="Перегляд" />
        <div className="hp-card">
          <div className="hp-skeleton" style={{ height: 48 }} />
          <div className="hp-skeleton hp-watch__frame" />
        </div>
      </section>
    );

  // Ліцензія (блок license з Mikai): кнопка «Легально: Netflix» у шапці; підказка — чи є українська озвучка/субтитри.
  const lic = p.license;
  const licWhat = lic ? [lic.dub && 'українська озвучка', lic.subs && 'українські субтитри'].filter(Boolean).join(', ') : '';
  const license = lic && (
    <a
      className={btn('ghost', 'sm')}
      href={lic.link}
      target="_blank"
      rel="noreferrer noopener"
      title={`Ліцензовано в Україні: ${lic.by}${licWhat ? ` — ${licWhat}` : ''}`}
    >
      Легально: {lic.by}
      {lic.link && <IconExternal />}
    </a>
  );

  if (p.status === 'not-found' || !team || !player)
    return (
      <section className="hp-section">
        <Header title="Перегляд">
          {license}
        </Header>
        <div className="hp-card">
          <p className="hp-p hp-state">
            {p.error
              ? `Не вдалося завантажити серії: ${p.error}`
              : lic
                ? `Аніме ліцензоване в Україні — дивіться на ${lic.by}${licWhat ? ` (${licWhat})` : ''}.`
                : 'Не знайшли серій на Mikai та AnimeON.'}
          </p>
        </div>
      </section>
    );

  const st = p.episodes[ep];
  const ed = p.edInfo && p.edInfo.ep === ep ? p.edInfo : null;
  // Пункт списку плеєрів (ліва панель поверх плеєра).
  const playerItem = (x: WatchPlayer) => (
    <>
      <span className="hp-grow hp-ellipsis">{x.label || PLAYER_NAMES[x.kind]}</span>
      <span className="hp-option__hint">
        {[x.noAds && 'Без реклами', dupKind(x) && SITE_NAMES[x.site]].filter(Boolean).join(' · ')}
      </span>
      <button
        type="button"
        className={cx('hp-watch__fav', p.prefs.favPlayer === x.kind && 'hp-watch__fav--on')}
        aria-label="Улюблений плеєр"
        aria-pressed={p.prefs.favPlayer === x.kind}
        title="Улюблений плеєр — обирати першим"
        onClick={(e) => {
          e.stopPropagation();
          p.onPrefs({ favPlayer: p.prefs.favPlayer === x.kind ? undefined : x.kind });
        }}
      >
        <IconHeart />
      </button>
    </>
  );
  const pickPlayer = (x: WatchPlayer) => {
    startAt.current = p.resumeAt?.() ?? 0;
    setPlayerId(x.id);
  };
  // Кнопки поверх плеєра з анімацією появи й зникання: поки ховаються — малюємо останній вигляд (useLeave).
  const overDiv: ReactElement<{ className: string }> | null = overOn ? (
      // Кнопки поверх плеєра — у стилі самого плеєра (MK 2026-11-26 13:03): Moon / Fenix / Ashdi, інакше — Hikka (style.css, .hp-ob).
      // «Наступний сезон» Fenix сам не показує — малюємо й поверх його міток.
      <div
        className={`hp-watch__over hp-watch__over--${player.kind}`}
        style={uiB != null && player.kind !== 'fenix' ? ({ '--hp-over-b': `${uiB}px` } as CSSProperties) : undefined}
      >
        {skipNow && skipShow && (
          <button type="button" className="hp-ob" title="Клавіша S у плеєрі" onClick={() => doSkip(skipNow.kind, skipNow.seg.e)}>
            <IconFwd />
            <span>{skipNow.kind === 'op' ? 'Пропустити опенінг' : afterEd(skipNow.seg.e) ? 'Сцена після титрів' : 'Пропустити ендинг'}</span>
            <kbd className="hp-ob__key">S</kbd>
          </button>
        )}
        {seasonNow && (
          <button
            type="button"
            className="hp-ob hp-ob--primary"
            title={`${seasonNow.list ? 'Далі з «Дивлюсь»' : seasonNow.soon ? 'Анонс' : 'Наступний сезон'}: ${seasonNow.title} (клавіша N у плеєрі)`}
            onClick={() => goSeason(seasonNow.slug)}
          >
            <IconSkipFwd />
            <span className="hp-ob__text">
              {seasonNow.list ? 'Далі з «Дивлюсь»' : 'Наступний сезон'}
              <span className="hp-ob__sub">
                {seasonNow.list ? `${seasonNow.title} · Серія ${seasonNow.list}` : seasonNow.soon ? `Анонс · ${seasonNow.title}` : seasonNow.title}
              </span>
            </span>
            <kbd className="hp-ob__key">N</kbd>
          </button>
        )}
        {nextNow && !fenixOwn && (
          <span className="hp-ob__group">
            <button
              type="button"
              className="hp-ob hp-ob--primary"
              title={p.epTitles?.[ep + 1] ? `Серія ${ep + 1}: ${p.epTitles[ep + 1]} (клавіша N у плеєрі)` : 'Клавіша N у плеєрі'}
              style={nextNow.left !== null ? ({ '--hp-ob-p': `${(1 - nextNow.left / NEXT_COUNTDOWN) * 100}%` } as CSSProperties) : undefined}
              onClick={() => goEp(ep + 1)}
            >
              <IconSkipFwd />
              <span className="hp-ob__text">
                Наступна серія
                {p.epTitles?.[ep + 1] ? <span className="hp-ob__sub">{p.epTitles[ep + 1]}</span> : null}
              </span>
              {nextNow.left !== null ? <span className="hp-ob__count">{Math.ceil(nextNow.left)}</span> : <kbd className="hp-ob__key">N</kbd>}
              {nextNow.left !== null && <span className="hp-ob__bar" aria-hidden="true" />}
            </button>
            {nextNow.left !== null && (
              <button
                type="button"
                className="hp-ob hp-ob--icon"
                aria-label="Не перемикати"
                title="Не перемикати — дивитися до кінця"
                onClick={() => {
                  nextOff.current.add(ep);
                  setNext(null);
                }}
              >
                <IconClose />
              </button>
            )}
          </span>
        )}
      </div>
  ) : null;
  const [overView, overOut] = useLeave(overDiv, 220);

  const frame = (
    <div
      ref={viewRef}
      className="hp-watch__view"
      onPointerOver={(e) => (e.target as Element).tagName !== 'IFRAME' && holdOn(true)}
      onPointerMove={(e) => (e.target as Element).tagName !== 'IFRAME' && holdOn(false)}
      onPointerLeave={holdOff}
      style={{ '--hp-menu-a': String((p.prefs.menuLevel ?? DEFAULT_MENU_LEVEL) / 100) } as CSSProperties}
    >
    {ambient && !p.renderFrame && (
      <canvas
        ref={setGlowEl}
        className="hp-watch__glow"
        aria-hidden="true"
        style={
          {
            '--hp-glow': String((p.prefs.ambientLevel ?? DEFAULT_AMBIENT_LEVEL) / 100),
            '--hp-glow-b': String((p.prefs.ambientBright ?? DEFAULT_AMBIENT_BRIGHT) / 100),
          } as CSSProperties
        }
      />
    )}
    <div ref={frameRef} className={`hp-watch__frame hp-watch__frame--${player.kind}`}>
      {p.renderFrame ? (
        p.renderFrame(player, ep)
      ) : (
        <PlayerFrame
          key={`${player.id}:${frameEp}`}
          player={player}
          ep={frameEp}
          startAt={startAt}
          onTime={(t, d) => {
            // Почали дивитися — більше не перескакуємо самі на «першу непереглянуту» (інакше при заліку серії
            // на початку ендингу блок перемикав на наступну посеред ендингу).
            if (t > 3) picked.current = true;
            moved(t);
            p.onTime?.(ep, t, d);
            const tt = Math.floor(t);
            posStore.set({ ep, t: tt, d });
            const next = skipAt(mkRef.current, tt);
            setSkip((x) =>
              x?.ep === ep && x.kind === next?.kind && x.seg.s === next.seg.s && x.seg.e === next.seg.e ? x : next ? { ...next, ep } : null,
            );
            // «Наступна серія»: від порогу зарахування; перемотали назад нижче порогу — відлік спочатку.
            const thr = edRef.current;
            let nx: { ep: number; left: number | null } | null = null;
            if (thr && thr.ep === ep && tt >= thr.next && canNextRef.current(ep) && !nextOff.current.has(ep)) {
              let left: number | null = null;
              if (p.prefs.nextCountdown && thr.auto) {
                const t0 = nextT0.current.get(ep) ?? tt;
                nextT0.current.set(ep, t0);
                left = Math.max(0, NEXT_COUNTDOWN - (tt - t0));
                if (left === 0 && !nextFired.current.has(ep)) {
                  nextFired.current.add(ep);
                  setTimeout(() => goEpRef.current(ep + 1));
                }
              }
              nx = { ep, left };
            } else if (thr && thr.ep === ep && tt < thr.next) {
              nextT0.current.delete(ep);
              nextFired.current.delete(ep);
            }
            setNext((x) => (x?.ep === nx?.ep && x?.left === nx?.left ? x : nx));
            setSeason(thr && thr.ep === ep && tt >= thr.next && seasonRef.current(ep) ? ep : 0);
          }}
          onSegs={(m) => p.onSegs?.(ep, m)}
          seekRef={seekRef}
          onHotkey={(key) => hotkeyRef.current(key)}
          onActive={(on) => {
            if (on) holdOff(); // справжній рух у самому плеєрі — він уже сам бачить мишу
            else holdIfOurs();
            wakeTools(on);
          }}
          watchUi={overOn && player.kind !== 'fenix'}
          onUi={(px) => {
            // Кадр може бути нижче/вище за низ блоку (Moon «Під кадром») — рахуємо від низу блоку.
            const f = frameRef.current?.querySelector('iframe');
            const v = viewRef.current;
            const off = f && v ? Math.round(v.getBoundingClientRect().bottom - f.getBoundingClientRect().bottom) : 0;
            const b = px > 0 ? px + off + 12 : Math.max(off, 0) + 16;
            setUiB((x) => (x === b ? x : b));
          }}
          countAt={frameEp === ep && ed && !ed.own ? ed.at : null}
          barSegs={frameEp === ep && mk ? (['op', 'ed'] as const).flatMap((k) => (mk.m[k] && mk.m[k]!.src !== 'player' ? [[k, Math.round(mk.m[k]!.s), Math.round(mk.m[k]!.e)] as BarSeg] : [])) : []}
          onEnded={() => {
            const cur = ep;
            p.onEnded?.(cur);
            if (!p.prefs.autoNext || cur >= count || !teamHas(cur + 1)) return;
            if (player.kind !== 'fenix' || !has(cur + 1)) return goEp(cur + 1);
            // Fenix може й сам перейти на наступну (episode_change) — тоді не перезавантажуємо.
            const at = Date.now();
            setTimeout(() => {
              if (selfSwitch.current < at) goEpRef.current(cur + 1);
            }, 3000);
          }}
          onEpisode={playerEp}
          glow={ambient ? glowEl : null}
          devices={!!p.prefs.devices}
        />
      )}
    </div>
    {overView && overOut ? cloneElement(overView, { className: `${overView.props.className} hp-watch__over--out` }) : overView}
    {/*
      Ліворуч угорі поверх плеєра (MK 2026-11-26 13:33): «◀ Серія N ▶» і озвучка зі списком команд — щоб у повному екрані
      можна було гортати серії й міняти озвучку, і плеєр (MK 2026-11-26 15:41); рядка над плеєром і Dawn більше немає.
    */}
    <div
      className={cx('hp-watch__tools', 'hp-watch__tools--left', `hp-watch__tools--${player.kind}`, (tools || still || teamOpen || epOpen || playerOpen) && 'hp-watch__tools--on')}
      onPointerEnter={() => {
        toolsHover.current = true;
        wakeTools(true);
      }}
      onPointerLeave={() => {
        toolsHover.current = false;
        wakeTools(true);
      }}
    >
      <Button variant="ghost" size="sm" icon className="hp-watch__tool hp-watch__tool--arrow" aria-label="Попередня серія" title="Попередня серія" disabled={ep <= 1} onClick={() => goEp(ep - 1)}>
        <IconLeft />
      </Button>
      <EpisodeMenu
        ep={ep}
        count={count}
        episodes={p.episodes}
        titles={p.epTitles}
        kinds={p.epKinds}
        teamHas={teamHas}
        onPick={goEp}
        onOpen={setEpOpen}
        canUnwatch={p.canUnwatch}
        onMark={p.onMark}
        onUnwatch={p.onUnwatch}
      />
      <Button
        variant="ghost"
        size="sm"
        icon
        className="hp-watch__tool hp-watch__tool--arrow"
        aria-label="Наступна серія"
        title="Наступна серія (клавіша N у плеєрі)"
        disabled={ep >= count || !teamHas(ep + 1)}
        onClick={() => goEp(ep + 1)}
      >
        <IconRight />
      </Button>
      {p.teams.length > 0 && (
        <>
          <span className="hp-watch__toolsep" aria-hidden="true" />
          <Picker
            className="hp-watch__toolteam"
            triggerClass="hp-watch__tool hp-watch__tool--team"
            label="Озвучка"
            items={p.teams}
            value={team}
            keyOf={(t) => t.id}
            trigger={
              <>
                <Avatar t={team} />
                <span className="hp-ellipsis">{team.name}</span>
              </>
            }
            item={(t) => <TeamLine t={t} full />}
            onOpen={setTeamOpen}
            onPick={(t) => {
              startAt.current = 0;
              setTeamId(t.id);
              setPlayerId(undefined);
            }}
          />
        </>
      )}
      {/* Плеєр — на панелі, видно завжди (MK 2026-11-26 15:41: «я говорил плеер не прятать»; у ⚙ його більше немає). */}
      <span className="hp-watch__toolsep" aria-hidden="true" />
      <Picker
        className="hp-watch__toolteam hp-watch__toolplayer"
        triggerClass="hp-watch__tool hp-watch__tool--team"
        label="Плеєр"
        items={players}
        value={player}
        keyOf={(x) => x.id}
        trigger={<span className="hp-ellipsis">{PLAYER_NAMES[player.kind]}</span>}
        item={playerItem}
        onOpen={setPlayerOpen}
        onPick={(x) => x.id !== player.id && pickPlayer(x)}
      />
    </div>
    {/* Кнопки блоку — панеллю поверх плеєра, справа вгорі (MK 2026-11-26 13:22); стиль — як у кнопок «Пропустити» (.hp-ob). */}
    <div
      className={cx('hp-watch__tools', `hp-watch__tools--${player.kind}`, (tools || still || menu || marksOpen) && 'hp-watch__tools--on')}
      onPointerEnter={() => {
        toolsHover.current = true;
        wakeTools(true);
      }}
      onPointerLeave={() => {
        toolsHover.current = false;
        wakeTools(true);
      }}
    >
        {mk && (mk.m.op || mk.m.ed) && <MarksTool key={ep} info={mk} onSeek={(sec) => seekRef.current?.(sec)} onOpen={setMarksOpen} />}
        <div className="hp-select" ref={menuWrap}>
          <Button variant="ghost" size="sm" icon className="hp-watch__tool" aria-label="Налаштування плеєра" title="Налаштування плеєра" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <IconSettings />
          </Button>
          {menu && (
            <div className="hp-popover hp-popover--end hp-watch__menu">
              <SwitchRow label="Автоперехід" hint="Наступна серія після кінця поточної; вручну — клавіша N у плеєрі" checked={p.prefs.autoNext} onChange={(v) => p.onPrefs({ autoNext: v })} />
              <SwitchRow label="Відлік на ендингу" hint={`Кнопка «Наступна серія» — і через ${NEXT_COUNTDOWN} с перехід сам`} checked={!!p.prefs.nextCountdown} onChange={(v) => p.onPrefs({ nextCountdown: v })} />
              <SwitchRow label="Далі з «Дивлюсь»" hint="На останній серії без наступного сезону — інший тайтл з вашого списку на Hikka" checked={p.prefs.upNext !== false} onChange={(v) => p.onPrefs({ upNext: v })} />
              <SwitchRow label="Відмічати в Hikka" hint="Серія зараховується, коли дійшли до ендингу" checked={p.prefs.hikkaSync} onChange={(v) => p.onPrefs({ hikkaSync: v })} />
              <SwitchRow label="Мітки опенінгу й ендингу" hint="З плеєра, інакше приблизні з AniSkip" checked={marksOn} onChange={(v) => p.onPrefs({ marks: v })} />
              {marksOn && (
                <>
                  <SwitchRow label="Пропускати опенінг сам" hint="Вручну — кнопка над плеєром або клавіша S у плеєрі" checked={!!p.prefs.skipOp} onChange={(v) => p.onPrefs({ skipOp: v })} />
                  <SwitchRow label="Пропускати ендинг сам" checked={!!p.prefs.skipEd} onChange={(v) => p.onPrefs({ skipEd: v })} />
                </>
              )}
              <MenuOpacityField prefs={p.prefs} onPrefs={p.onPrefs} />
              <SwitchRow label="Підсвітка" hint="Кольори з відео навколо плеєра" checked={ambient} onChange={(v) => p.onPrefs({ ambient: v })} />
              {ambient && (
                <AmbientFields prefs={p.prefs} onPrefs={p.onPrefs} />
              )}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon
          className="hp-watch__tool hp-watch__tool--lights"
          aria-pressed={dark}
          aria-label={dark ? 'Увімкнути світло' : 'Вимкнути світло'}
          title={dark ? 'Увімкнути світло' : 'Вимкнути світло — затемнити все навколо плеєра'}
          onClick={() => setDark((x) => !x)}
        >
          <IconBulb />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon
          className="hp-watch__tool hp-watch__wide"
          aria-pressed={effWide}
          aria-label={wide ? 'Звичайний розмір' : 'Ширше'}
          title={moonWide ? 'Moon завжди ширше: у вузькому блоці його панель блимає' : wide ? 'Звичайний розмір' : 'Ширше'}
          disabled={player.kind === 'moon' && !noWide}
          onClick={() => toggleWide(!wide)}
        >
          <IconTv />
        </Button>
        {effWide && effSize === 'screen' && (
          <Button variant="ghost" size="sm" icon className="hp-watch__tool" aria-label="Вирівняти плеєр по екрану" title="Вирівняти плеєр по екрану" onClick={fitScreen}>
            <IconScan />
          </Button>
        )}
        {effWide && (
          <Button
            variant="ghost"
            size="sm"
            icon
            className="hp-watch__tool hp-watch__wide"
            aria-label={`Розмір плеєра: ${SIZE_LABEL[nextSize].toLowerCase()}`}
            title={`Розмір плеєра: ${SIZE_LABEL[nextSize].toLowerCase()}`}
            onClick={() => {
              setSize(nextSize);
              p.onPrefs({ size: nextSize });
            }}
          >
            {nextSize === 'window' ? <IconMoveH /> : nextSize === 'screen' ? <IconMoveV /> : <IconMoveBack />}
          </Button>
        )}
        {canFull && (
          <Button
            variant="ghost"
            size="sm"
            icon
            className="hp-watch__tool"
            aria-label={full ? 'Вийти з повного екрана' : 'На весь екран'}
            title={full ? 'Вийти з повного екрана' : 'На весь екран'}
            onClick={toggleFull}
          >
            {full ? <IconShrink /> : <IconExpand />}
          </Button>
        )}
    </div>
    </div>
  );
  const stageCb = (el: HTMLElement | null) => {
    stageRef.current = el;
    setStageEl(el);
  };

  const ranges = Math.ceil(count / RANGE);
  const from = ranges > 1 ? Number(range) * RANGE + 1 : 1;
  const to = ranges > 1 ? Math.min(count, from + RANGE - 1) : count;
  const h = p.hikka;

  const rest = (
    <>

      <div className="hp-watch__nav">
        <Button variant="secondary" size="md" icon aria-label="Попередня серія" disabled={ep <= 1} onClick={() => goEp(ep - 1)}>
          <IconLeft />
        </Button>
        <div className="hp-watch__epname">
          <span>
            Серія {ep}
            <span className="hp-header__count"> з {count}</span>
          </span>
          {p.epTitles?.[ep] ? (
            <span className="hp-watch__eptitle" title={p.epTitles[ep]}>
              {p.epTitles[ep]}
            </span>
          ) : null}
          <span className="hp-watch__hint">
            {st?.watched ? (
              <>
                <IconEye /> Переглянуто
                {p.canUnwatch?.(ep) ? (
                  <Button variant="ghost" size="xs" className="hp-watch__undo" title={`Зняти відмітку з серії ${ep}`} onClick={() => p.onUnwatch?.(ep)}>
                    Скасувати
                  </Button>
                ) : (
                  <span title="Зарахована в списку Hikka. Щоб зняти — «−» у віджеті Hikka або «Відмічати в Hikka».">· у Hikka</span>
                )}
              </>
            ) : null}
          </span>
        </div>
        <Button variant="secondary" size="md" icon aria-label="Наступна серія" disabled={ep >= count || !teamHas(ep + 1)} onClick={() => goEp(ep + 1)}>
          <IconRight />
        </Button>
        {h?.kind === 'count' && (
          <span className="hp-watch__hikka">
            Hikka: {h.n} / {p.total ?? count}
          </span>
        )}
        {h?.kind === 'connect' && (
          <Button variant="ghost" size="sm" className="hp-watch__hikka" title="Увійти в Hikka з дозволом на список перегляду" onClick={h.onClick}>
            Відмічати в Hikka
          </Button>
        )}
        {h?.kind === 'error' && (
          <span className="hp-watch__hikka" title={h.message}>
            Hikka: помилка
          </span>
        )}
      </div>

      <div className="hp-sep" />

      <div className="hp-col hp-col--tight">
        <div className="hp-watch__epsHead">
          <span className="hp-setrow__label">Епізоди</span>
          {ranges > 1 && (
            <ChipTabs
              label="Діапазон серій"
              value={range}
              onPick={setRange}
              options={Array.from({ length: ranges }, (_, i) => ({
                value: String(i),
                label: `${i * RANGE + 1}–${Math.min(count, (i + 1) * RANGE)}`,
              }))}
            />
          )}
        </div>
        <div className="hp-watch__grid" role="list">
          {Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => {
            const n = from + i;
            const s = p.episodes[n];
            const on = n === ep;
            const seen = !!s?.watched;
            const lockSeen = seen && !p.canUnwatch?.(n);
            return (
              <div key={n} role="listitem" className={cx('hp-watch__cell', seen && 'hp-watch__cell--seen')}>
                <button
                  type="button"
                  className={cx(btn(on ? 'default' : 'secondary', 'md'), 'hp-watch__ep', seen && !on && 'hp-watch__ep--seen')}
                  disabled={!teamHas(n)}
                  aria-current={on || undefined}
                  title={epHint(n, p.epTitles?.[n], !teamHas(n) ? 'ще немає в цієї команди' : !has(n) ? `у плеєрі ${PLAYER_NAMES[playerFor(n)!.kind]}` : seen ? 'переглянуто' : s?.pos ? `${Math.round(s.pos * 100)}%` : '', p.epKinds?.[n])}
                  onClick={() => goEp(n)}
                >
                  {n}
                  {epType(p.epKinds?.[n])}
                  {!seen && s?.pos ? <span className="hp-watch__epbar" style={{ width: `${s.pos * 100}%` }} /> : null}
                </button>
                {/* Глазок — окремий перемикач «переглянуто» (MK 03:54: «тут має бути можливість позначати»). */}
                {(teamHas(n) || seen) && (
                  <button
                    type="button"
                    className="hp-watch__eye"
                    aria-pressed={seen}
                    aria-label={seen ? `Зняти відмітку з серії ${n}` : `Позначити серію ${n} переглянутою`}
                    title={
                      lockSeen
                        ? 'Зарахована в списку Hikka. Щоб зняти — «−» у віджеті Hikka або «Відмічати в Hikka».'
                        : seen
                          ? `Зняти відмітку з серії ${n}`
                          : `Позначити серію ${n} переглянутою`
                    }
                    disabled={lockSeen}
                    onClick={() => (seen ? p.onUnwatch?.(n) : p.onMark?.(n))}
                  >
                    {/* Непереглянута — перекреслене око (MK 15:38), переглянута — відкрите. */}
                    {seen ? <IconEye /> : <IconEyeOff />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* Легенда «Типи серій» — лише якщо в тайтлу вони є (як у Mikai). */}
        {kindsHere.length > 0 && (
          <div className="hp-watch__eplegend">
            {kindsHere.map((k) => (
              <span key={k} title={EP_KIND_INFO[k][1]}>
                <span className={`hp-watch__eptype hp-watch__eptype--${k}`} aria-hidden="true" />
                {EP_KIND_INFO[k][0]}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const body = (
    <>
      <Header title="Перегляд">
        {license}
      </Header>
      <div className="hp-card">
        {frame}
        {rest}
      </div>
    </>
  );

  // «Ширше» (рішення MK 2026-11-23, 03:06): увесь блок — на ширину сітки, під верхніми картками бічних колонок.
  // Блок лишається на своєму місці в DOM (iframe не перезавантажується), лише стає position:absolute — wide-layout.ts.
  return (
    <section
      ref={stageCb}
      className={cx('hp-section hp-watch hp-watch__stage', effWide && 'hp-watch__stage--wide', effSize !== 'grid' && `hp-watch__stage--${effSize}`)}
    >
      {body}
    </section>
  );
}

/** Значення, що зникає, ще ms мілісекунд лишається на екрані (анімація зникання); друге — «зараз ховається». */
function useLeave<T>(v: T | null, ms: number): [T | null, boolean] {
  const keep = useRef<T | null>(null);
  const [, tick] = useState(0);
  if (v != null) keep.current = v;
  const on = v != null;
  useEffect(() => {
    if (on || keep.current == null) return;
    const t = window.setTimeout(() => {
      keep.current = null;
      tick((x) => x + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return [v ?? keep.current, !on && keep.current != null];
}

/* ---------- Позиція й «Пропустити» ---------- */

type Pos = { ep: number; t: number; d: number };
type PosStore = { get: () => Pos | null; set: (p: Pos) => void };
type SkipState = { kind: 'op' | 'ed'; seg: Seg };

function createPosStore(): PosStore {
  let cur: Pos | null = null;
  return {
    get: () => cur,
    set(p) {
      cur = p;
    },
  };
}

/** Чи зараз опенінг/ендинг (до кінця шматка лишилося > 2 с) — для кнопки «Пропустити». */
function skipAt(mk: MarksInfo | null, t: number): SkipState | null {
  for (const kind of ['op', 'ed'] as const) {
    const seg = mk?.m[kind];
    if (seg && t >= seg.s && t < seg.e - 2) return { kind, seg };
  }
  return null;
}

