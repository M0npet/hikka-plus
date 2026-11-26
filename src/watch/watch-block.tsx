/*
 * Блок «Перегляд» на сторінці аніме (між «Опис» і «Головні персонажі»).
 * Команда → плеєр → iframe самого плеєра; кнопка Dawn веде на Mikai (вбудовування немає);
 * «Ширше» — увесь блок на ширину сітки сторінки (wide-layout.ts); блок не переїжджає в DOM, iframe не перезавантажується.
 */
import { browser } from '#imports';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Button, Check, ChipTabs, Header, SwitchRow, btn } from '../ui/kit';
import { IconExpand, IconExternal, IconEye, IconEyeOff, IconHeart, IconLeft, IconRight, IconSettings, IconShrink, IconTv, IconBulb, IconMoveH, IconMoveV, IconMoveBack, IconScan } from '../ui/icons';
import { useLightsOff } from './lights-off';
import { attachPlayer } from './adapters';
import { useWideLayout } from './wide-layout';
import { AMBIENT_MSG, AMBIENT_REQ, PLAYER_NAMES, SITE_NAMES, teamEpisodes, type EpisodeState, type WatchPlayer, type WatchTeam } from './types';
import { DEFAULT_AMBIENT_BRIGHT, DEFAULT_AMBIENT_LEVEL, DEFAULT_WIDE_ANIM, type WatchPrefs, type WatchSize } from './watch-store';
import { AmbientFields } from './ambient-fields';
import type { LightsMsg } from '../lights/types';
import type { MarkSrc, Seg } from './skip-marks';
import type { UaLicense } from './providers';
import type { MarksInfo } from './watch-root';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const RANGE = 50;

export type HikkaLine = { kind: 'count'; n: number } | { kind: 'connect'; onClick: () => void } | { kind: 'error'; message: string } | null;

export type WatchBlockProps = {
  status: 'loading' | 'ready' | 'not-found';
  error?: string;
  teams: WatchTeam[];
  /** Стан серій за номером. */
  episodes: Record<number, EpisodeState>;
  /** Серій за Hikka (сітка показує й ще не додані на сайти). */
  total?: number;
  hikka?: HikkaLine;
  /** Посилання «Anitube» (лише посиланням — Cloudflare). */
  anitube?: string;
  /** Українська ліцензія з Mikai: де дивитися легально (кнопка в шапці; без серій — замість «не знайшли»). */
  license?: UaLicense;
  /** Поріг зарахування поточної серії: at — секунда, ed — це початок ендингу (а не приблизний поріг без міток). */
  edInfo?: { ep: number; at: number; ed: boolean } | null;
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
}: {
  items: T[];
  value: T | undefined;
  keyOf: (t: T) => string;
  trigger: ReactNode;
  item: (t: T) => ReactNode;
  onPick: (t: T) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
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
        className="hp-input hp-input--lg hp-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="hp-grow hp-watch__trig">{trigger}</span>
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

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- Сам блок ---------- */

/** Скільки пікселів (кадр 32×18) додаємо з кожного боку для країв підсвітки; у style.css — ті самі пропорції (.hp-watch__glow). */
const GLOW_PAD = 4;

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
  const [range, setRange] = useState('0');
  // З якої секунди почати після (пере)завантаження iframe.
  const startAt = useRef(init?.t ?? 0);
  // Поточна позиція (крок 1 с) — у маленькому сховищі: щосекунди перемальовується лише смужка міток (LiveMarksBar),
  // а весь блок (сітка серій, меню) — лише коли кнопка «Пропустити» з'являється/зникає.
  const posStore = useMemo(createPosStore, []);
  const [skip, setSkip] = useState<(SkipState & { ep: number }) | null>(null);
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
    if (full) void document.exitFullscreen?.().catch(() => {});
    else void viewRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Мітки OP/ED: кнопка «Пропустити» поверх плеєра (і в повному екрані) та автопропуск, якщо ввімкнено.
  const mk = marksOn && p.marks && p.marks.ep === ep ? p.marks : null;
  mkRef.current = mk;
  const skipNow = mk && skip && skip.ep === ep ? skip : null;
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

  const anitube = p.anitube && (
    <a className={btn('ghost', 'sm')} href={p.anitube} target="_blank" rel="noreferrer noopener">
      Anitube
      <IconExternal />
    </a>
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
          {anitube}
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
  const frame = (
    <div ref={viewRef} className="hp-watch__view">
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
            p.onTime?.(ep, t, d);
            const tt = Math.floor(t);
            posStore.set({ ep, t: tt, d });
            const next = skipAt(mkRef.current, tt);
            setSkip((x) =>
              x?.ep === ep && x.kind === next?.kind && x.seg.s === next.seg.s && x.seg.e === next.seg.e ? x : next ? { ...next, ep } : null,
            );
          }}
          onSegs={(m) => p.onSegs?.(ep, m)}
          seekRef={seekRef}
          countAt={frameEp === ep && ed && !st?.watched ? ed.at : null}
          countEd={!!ed?.ed}
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
    {skipNow && (
      <button type="button" className={cx(btn('secondary', 'sm'), 'hp-watch__skip')} onClick={() => doSkip(skipNow.kind, skipNow.seg.e)}>
        {skipNow.kind === 'op' ? 'Пропустити опенінг' : 'Пропустити ендинг'} <IconRight />
      </button>
    )}
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

  const bar = (
    <div className="hp-watch__bar">
      <Picker
        className="hp-watch__team"
        label="Команда"
        items={p.teams}
        value={team}
        keyOf={(t) => t.id}
        trigger={<TeamLine t={team} />}
        item={(t) => <TeamLine t={t} full />}
        onPick={(t) => {
          startAt.current = 0;
          setTeamId(t.id);
          setPlayerId(undefined);
        }}
      />
      <Picker
        className="hp-watch__player"
        label="Плеєр"
        items={players}
        value={player}
        keyOf={(x) => x.id}
        trigger={<span className="hp-ellipsis">{PLAYER_NAMES[player.kind]}</span>}
        item={(x) => (
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
        )}
        onPick={(x) => {
          startAt.current = p.resumeAt?.() ?? 0;
          setPlayerId(x.id);
        }}
      />
      {team.dawn && (
        <a className={btn('outline', 'lg', false, 'hp-watch__dawn')} href={team.dawn(ep)} target="_blank" rel="noreferrer noopener" title="Dawn не вбудовується — відкриється ця серія на Mikai">
          Dawn
          <IconExternal />
        </a>
      )}
    </div>
  );
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
                  title={!teamHas(n) ? `Серії ${n} ще немає в цієї команди` : !has(n) ? `Серія ${n} — у плеєрі ${PLAYER_NAMES[playerFor(n)!.kind]}` : seen ? `Серія ${n} — переглянуто` : s?.pos ? `Серія ${n} — ${Math.round(s.pos * 100)}%` : `Серія ${n}`}
                  onClick={() => goEp(n)}
                >
                  {n}
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
      </div>
    </>
  );

  const body = (
    <>
      <Header title="Перегляд">
        {license}
        {anitube}
        <div className="hp-select" ref={menuWrap}>
          <Button variant="ghost" size="sm" icon aria-label="Налаштування плеєра" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <IconSettings />
          </Button>
          {menu && (
            <div className="hp-popover hp-popover--end hp-watch__menu">
              <SwitchRow label="Автоперехід" hint="Наступна серія після кінця поточної" checked={p.prefs.autoNext} onChange={(v) => p.onPrefs({ autoNext: v })} />
              <SwitchRow label="Відмічати в Hikka" hint="Серія зараховується, коли дійшли до ендингу" checked={p.prefs.hikkaSync} onChange={(v) => p.onPrefs({ hikkaSync: v })} />
              <SwitchRow label="Мітки опенінгу й ендингу" hint="З плеєра, інакше приблизні з AniSkip" checked={marksOn} onChange={(v) => p.onPrefs({ marks: v })} />
              {marksOn && (
                <>
                  <SwitchRow label="Пропускати опенінг сам" checked={!!p.prefs.skipOp} onChange={(v) => p.onPrefs({ skipOp: v })} />
                  <SwitchRow label="Пропускати ендинг сам" checked={!!p.prefs.skipEd} onChange={(v) => p.onPrefs({ skipEd: v })} />
                </>
              )}
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
          className="hp-watch__wide"
          aria-pressed={effWide}
          aria-label={wide ? 'Звичайний розмір' : 'Ширше'}
          title={moonWide ? 'Moon завжди ширше: у вузькому блоці його панель блимає' : wide ? 'Звичайний розмір' : 'Ширше'}
          disabled={player.kind === 'moon' && !noWide}
          onClick={() => toggleWide(!wide)}
        >
          <IconTv />
        </Button>
        {effWide && effSize === 'screen' && (
          <Button variant="ghost" size="sm" icon aria-label="Вирівняти плеєр по екрану" title="Вирівняти плеєр по екрану" onClick={fitScreen}>
            <IconScan />
          </Button>
        )}
        {effWide && (
          <Button
            variant="ghost"
            size="sm"
            icon
            className="hp-watch__wide"
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
            aria-label={full ? 'Вийти з повного екрана' : 'На весь екран'}
            title={full ? 'Вийти з повного екрана' : 'На весь екран'}
            onClick={toggleFull}
          >
            {full ? <IconShrink /> : <IconExpand />}
          </Button>
        )}
      </Header>
      <div className="hp-card">
        {bar}
        {frame}
        {mk && (mk.m.op || mk.m.ed) && (
          <LiveMarksBar key={ep} store={posStore} ep={ep} info={mk} onSeek={(sec) => seekRef.current?.(sec)} />
        )}
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

/* ---------- Смужка міток OP/ED під плеєром ---------- */

const SRC_NAMES: Record<MarkSrc, string> = { player: 'з плеєра', aniskip: 'AniSkip, приблизно' };
const KIND_NAMES = { op: 'Опенінг', ed: 'Ендинг' } as const;

type Pos = { ep: number; t: number; d: number };
type PosStore = { get: () => Pos | null; set: (p: Pos) => void; sub: (f: () => void) => () => void };
type SkipState = { kind: 'op' | 'ed'; seg: Seg };

function createPosStore(): PosStore {
  let cur: Pos | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set(p) {
      if (cur && cur.ep === p.ep && cur.t === p.t && cur.d === p.d) return;
      cur = p;
      subs.forEach((f) => f());
    },
    sub(f) {
      subs.add(f);
      return () => void subs.delete(f);
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

/** Смужка міток, що сама стежить за позицією — щоб щосекунди не перемальовувати весь блок. */
function LiveMarksBar(p: { store: PosStore; ep: number; info: MarksInfo; onSeek: (sec: number) => void }) {
  const now = useSyncExternalStore(p.store.sub, p.store.get);
  if (!now || now.ep !== p.ep || !(now.d > 0)) return null;
  return <MarksBar info={p.info} t={now.t} d={now.d} onSeek={p.onSeek} />;
}

/** Де OP і ED у цій серії: смужка на всю тривалість, клік — перемотка; під нею — час і звідки мітка. Показуємо, лише коли мітки є. */
export function MarksBar({ info, t, d, onSeek }: { info: MarksInfo | null; t: number; d: number; onSeek: (sec: number) => void }) {
  const m = info?.m ?? {};
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / d) * 100))}%`;
  const segs = (['op', 'ed'] as const).filter((k) => m[k]);
  const onBar = (e: { currentTarget: HTMLElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) onSeek(((e.clientX - r.left) / r.width) * d);
  };
  return (
    <div className="hp-watch__marks">
      <div className="hp-watch__track" role="presentation" onClick={onBar} title="Перемотати">
        {segs.map((k) => (
          <span
            key={k}
            className={`hp-watch__seg hp-watch__seg--${k}${m[k]!.src === 'aniskip' ? ' hp-watch__seg--rough' : ''}`}
            style={{ left: pct(m[k]!.s), width: `calc(${pct(m[k]!.e)} - ${pct(m[k]!.s)})` }}
          />
        ))}
        <span className="hp-watch__now" style={{ left: pct(t) }} />
      </div>
      <div className="hp-watch__legend">
        {segs.map((k) => (
          <button key={k} type="button" className="hp-watch__mark" onClick={() => onSeek(m[k]!.s)} title={`Перейти на початок: ${KIND_NAMES[k].toLowerCase()}`}>
            <span className={`hp-watch__dot hp-watch__dot--${k}`} />
            {KIND_NAMES[k]} {fmt(m[k]!.s)}–{fmt(m[k]!.e)}
            <span className="hp-muted"> · {SRC_NAMES[m[k]!.src]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** iframe плеєра як є + адаптер позиції. Адресу беремо в провайдера (у AnimeON — запитом). */
export function PlayerFrame(p: {
  player: WatchPlayer;
  ep: number;
  startAt: { current: number };
  onTime: (t: number, d: number) => void;
  onSegs: (segs: { op?: Seg; ed?: Seg }) => void;
  onEnded: () => void;
  onEpisode: (n: number) => void;
  /** Canvas підсвітки за рамкою; null — підсвітку вимкнено. */
  glow?: HTMLCanvasElement | null;
  /** Слати кадри ще й у background для пристроїв (src/lights/). */
  devices?: boolean;
  /** Сюди кладемо функцію перемотки (кнопки «Пропустити», смужка міток). */
  seekRef?: { current: ((sec: number) => void) | null };
  /** Секунда, з якої серія зарахується (риска на смужці самого плеєра); null — не показувати (уже переглянуто). */
  countAt?: number | null;
  /** countAt — це початок ендингу з міток (Fenix тоді риску не малюємо — у нього своя мітка ендингу). */
  countEd?: boolean;
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let off = false;
    setSrc(undefined);
    setErr(false);
    p.player
      .src(p.ep)
      .then((s) => !off && setSrc(s))
      .catch(() => {
        if (off) return;
        setErr(true);
        setSrc(null);
      });
    return () => {
      off = true;
    };
  }, [p.player, p.ep]);

  // Підсвітка: кадр 32×18 (рядок RGB) від нашого скрипта у фреймі (entrypoints/player-frame.content.ts) → canvas за рамкою (CSS розмиває).
  useEffect(() => {
    const f = ref.current;
    const c = p.glow ?? null;
    if (!src || !f) return;
    let origin = '';
    try {
      origin = new URL(src).origin;
    } catch {
      return;
    }
    const devices = !!p.devices;
    const want = !!c || devices;
    // Плеєр прокрутили з екрана — підсвітку не рахуємо (пристроям кадри потрібні завжди).
    let visible = true;
    const on = () => want && (visible || devices);
    // Пристрої: не частіше ніж 10 кадрів/с (повільні пристрої пропускають ще й самі, src/lights/engine.ts).
    let devAt = 0;
    const toDevices = (m: LightsMsg) => void browser.runtime.sendMessage(m).catch(() => {});
    // Поки у фреймі ще порожня about:blank (джерело — hikka.io), postMessage з origin плеєра лише сипле помилку в консоль.
    // Чужу сторінку прочитати не можна — отже, плеєр уже завантажився; до того питає сам скрипт фрейму ({ready}) і подія load.
    const loaded = () => {
      try {
        void f.contentWindow?.location.href;
        return false;
      } catch {
        return true;
      }
    };
    const ask = () => {
      if (loaded()) f.contentWindow?.postMessage({ type: AMBIENT_REQ, on: on() }, origin);
    };
    const ctx = c?.getContext('2d') ?? null;
    const tmp = document.createElement('canvas');
    const tctx = tmp.getContext('2d');
    // Як Ambilight у телевізорів (MK 15:39): навколо кадру — кольори його країв, витягнуті назовні (по GLOW_PAD пікселів
    // з кожного боку). CSS ставить canvas так, що середина збігається з рамкою, і розмиває.
    const pad = document.createElement('canvas');
    const pctx = pad.getContext('2d');
    let first = true;
    let img: ImageData | null = null;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.origin !== origin) return;
      const d = e.data as { type?: unknown; ready?: unknown; off?: unknown; w?: unknown; h?: unknown; rgb?: unknown; bar?: unknown } | null;
      if (!d || d.type !== AMBIENT_MSG) return;
      if (d.ready) return ask();
      // Moon з панеллю «Під кадром» (його налаштування): рамка вища, див. .hp-watch__frame--below у style.css.
      if (typeof d.bar === 'string') return void f.parentElement?.classList.toggle('hp-watch__frame--below', d.bar === 'below');
      if (d.off) {
        if (devices) toDevices({ type: 'hp-lights', stop: true });
        first = true; // кадри можуть піти знову (Ashdi: після реклами) — тоді показати й почати змішування заново
        return c?.classList.remove('is-on');
      }
      const w = Number(d.w);
      const h = Number(d.h);
      const rgb = d.rgb;
      if (typeof rgb !== 'string' || !(w > 0 && w <= 64 && h > 0 && h <= 64) || rgb.length !== w * h * 3) return;
      if (devices && Date.now() - devAt >= 100) {
        devAt = Date.now();
        toDevices({ type: 'hp-lights', frame: { w, h, rgb } });
      }
      if (!c || !ctx || !tctx || !pctx) return;
      const P = GLOW_PAD;
      if (tmp.width !== w || tmp.height !== h) {
        tmp.width = w;
        tmp.height = h;
        pad.width = c.width = w + 2 * P;
        pad.height = c.height = h + 2 * P;
        first = true;
      }
      if (!img || img.width !== w || img.height !== h) img = tctx.createImageData(w, h);
      for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        img.data[j] = rgb.charCodeAt(i);
        img.data[j + 1] = rgb.charCodeAt(i + 1);
        img.data[j + 2] = rgb.charCodeAt(i + 2);
        img.data[j + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      // Кадр у середині, краї (по 1 px) — розтягнуті назовні, кути — кутовими пікселями.
      pctx.drawImage(tmp, P, P);
      pctx.drawImage(tmp, 0, 0, 1, h, 0, P, P, h);
      pctx.drawImage(tmp, w - 1, 0, 1, h, P + w, P, P, h);
      pctx.drawImage(tmp, 0, 0, w, 1, P, 0, w, P);
      pctx.drawImage(tmp, 0, h - 1, w, 1, P, P + h, w, P);
      pctx.drawImage(tmp, 0, 0, 1, 1, 0, 0, P, P);
      pctx.drawImage(tmp, w - 1, 0, 1, 1, P + w, 0, P, P);
      pctx.drawImage(tmp, 0, h - 1, 1, 1, 0, P + h, P, P);
      pctx.drawImage(tmp, w - 1, h - 1, 1, 1, P + w, P + h, P, P);
      // Плавна зміна кольорів: новий кадр поверх старого з прозорістю.
      // Кадри йдуть 5 разів на секунду (0.6.0, було 10) — частка нового кадру більша, плавність та сама (~1 с).
      ctx.globalAlpha = first ? 1 : 0.4;
      ctx.drawImage(pad, 0, 0);
      if (first) c.classList.add('is-on');
      first = false;
    };
    window.addEventListener('message', onMsg);
    f.addEventListener('load', ask);
    const io =
      want && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([en]) => {
            const v = !!en?.isIntersecting;
            if (v === visible) return;
            visible = v;
            ask();
          })
        : null;
    io?.observe(f);
    ask();
    return () => {
      io?.disconnect();
      window.removeEventListener('message', onMsg);
      f.removeEventListener('load', ask);
      f.parentElement?.classList.remove('hp-watch__frame--below');
      c?.classList.remove('is-on');
      if (devices) toDevices({ type: 'hp-lights', stop: true });
      if (!want || !loaded()) return;
      try {
        f.contentWindow?.postMessage({ type: AMBIENT_REQ, on: false }, origin);
      } catch {
        /* фрейм уже прибрано */
      }
    };
  }, [src, p.glow, p.devices]);

  // Поріг зарахування серії — ризикою на смужці прокрутки самого плеєра (MK 2026-11-26: «нах подпись под, сделай
  // интеграцию в плеер»). Малює скрипт фрейму (entrypoints/player-frame.content.ts, Moon і Fenix); тут лише кажемо секунду.
  const countSec = p.countAt == null ? null : Math.round(p.countAt);
  const countEd = !!p.countEd;
  useEffect(() => {
    const f = ref.current;
    if (!src || !f) return;
    let origin = '';
    try {
      origin = new URL(src).origin;
    } catch {
      return;
    }
    const send = () => {
      try {
        void f.contentWindow?.location.href;
        return; // ще about:blank — плеєр не завантажився
      } catch {
        f.contentWindow?.postMessage({ type: AMBIENT_REQ, count: countSec, ed: countEd }, origin);
      }
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.origin !== origin) return;
      const d = e.data as { type?: unknown; ready?: unknown } | null;
      if (d?.type === AMBIENT_MSG && d.ready) send();
    };
    window.addEventListener('message', onMsg);
    f.addEventListener('load', send);
    send();
    return () => {
      window.removeEventListener('message', onMsg);
      f.removeEventListener('load', send);
    };
  }, [src, countSec, countEd]);

  useEffect(() => {
    const f = ref.current;
    if (!src || !f) return;
    // Повернення на збережену секунду: лише коли відео справді пішло (після реклами Ashdi), до 3 спроб.
    let tries = 0;
    let lastTry = 0;
    let resumed = false;
    const ctl = attachPlayer(f, p.player.kind, {
      onTime: (t, d) => {
        const want = cb.current.startAt.current;
        if (!resumed && want > 5 && want < d - 5) {
          if (t >= want - 3) resumed = true;
          else if (t > 0.5 && tries < 3 && Date.now() - lastTry > 1500) {
            tries++;
            lastTry = Date.now();
            ctl.seek(want);
            return;
          } else if (tries < 3) return; // ще реклама/завантаження — позицію не рахуємо
        }
        resumed = true;
        cb.current.onTime(t, d);
      },
      onEnded: () => cb.current.onEnded(),
      onSegs: (m) => cb.current.onSegs(m),
      onEpisode: (n) => cb.current.onEpisode(n),
    });
    // Перемотка: через наш скрипт у фреймі (video.currentTime — працює в усіх трьох плеєрах однаково),
    // а якщо сторінка плеєра ще не завантажилась — через API самого плеєра.
    const seekRef = cb.current.seekRef;
    if (seekRef)
      seekRef.current = (sec) => {
        let origin = '';
        try {
          origin = new URL(src).origin;
        } catch {
          /* немає */
        }
        let foreign = false;
        try {
          void f.contentWindow?.location.href;
        } catch {
          foreign = true;
        }
        if (foreign && origin) f.contentWindow?.postMessage({ type: AMBIENT_REQ, seek: sec }, origin);
        else ctl.seek(sec);
      };
    return () => {
      if (seekRef?.current) seekRef.current = null;
      ctl.detach();
    };
  }, [src, p.player.kind]);

  if (src === undefined) return <div className="hp-watch__empty">Завантаження…</div>;
  if (!src) return <div className="hp-watch__empty">{err ? 'Не вдалося отримати плеєр' : `У цього плеєра немає серії ${p.ep}`}</div>;
  return (
    <iframe
      ref={ref}
      src={src}
      // За name скрипт entrypoints/player-frame.content.ts пізнає наш фрейм.
      name="hikka-plus"
      title={`${PLAYER_NAMES[p.player.kind]} — серія ${p.ep}`}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="origin"
    />
  );
}
