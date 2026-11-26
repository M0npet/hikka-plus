/** iframe плеєра + адаптер позиції, підсвітка, мітки на смужці, вимір панелі плеєра (з watch-block.tsx, бэклог 2d). */
import { browser } from '#imports';
import { useEffect, useRef, useState } from 'react';
import { attachPlayer } from './adapters';
import { AMBIENT_MSG, AMBIENT_REQ, PLAYER_NAMES, type WatchPlayer } from './types';
import type { LightsMsg } from '../lights/types';
import type { Seg } from './skip-marks';

/** Відрізок на смужці плеєра: вид, початок і кінець у секундах. */
export type BarSeg = ['op' | 'ed', number, number];

/** Скільки пікселів (кадр 32×18) додаємо з кожного боку для країв підсвітки; у style.css — ті самі пропорції (.hp-watch__glow). */
const GLOW_PAD = 4;

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
  /** Гаряча клавіша в плеєрі: S — пропустити, N — наступна серія. */
  onHotkey?: (key: 'skip' | 'next') => void;
  /** Миша рухається в плеєрі (true) / вийшла з нього (false) — показати/сховати панель кнопок поверх плеєра. */
  onActive?: (on: boolean) => void;
  /** Секунда, з якої серія зарахується (риска на смужці самого плеєра); null — не показувати. MK 2026-11-26 17:13: завжди (і на переглянутій серії), крім випадку, коли в самого
   *  плеєра є своя мітка ендингу (Moon, Fenix) — тоді поріг = її початок, і плеєр уже його показує. */
  countAt?: number | null;
  /** Відрізки OP/ED, яких немає в самого плеєра (AniSkip), — малюються на його смужці (MK 2026-11-26 17:15). */
  barSegs?: BarSeg[];
  /** Наші кнопки поверх плеєра видно — фрейм міряє панель плеєра й шле onUi (MK 2026-11-26 17:32: «чтобы наши кнопки
   *  реагировали на интерфейс, выше-ниже»). Без кнопок — не міряємо. */
  watchUi?: boolean;
  /** Від низу кадру до верху панелі плеєра (смужка прокрутки + кнопки), px; 0 — панель схована. */
  onUi?: (px: number) => void;
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
      if (!d || d.type !== AMBIENT_MSG || 'ui' in d) return; // {ui} — для кнопок поверх плеєра (onUi)
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
  // интеграцию в плеер»). Малює скрипт фрейму (entrypoints/player-frame.content.ts, Moon, Ashdi і Fenix); тут лише кажемо секунду.
  const countSec = p.countAt == null ? null : Math.round(p.countAt);
  const segsKey = JSON.stringify(p.barSegs ?? []);
  const ui = !!p.watchUi;
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
        f.contentWindow?.postMessage({ type: AMBIENT_REQ, count: countSec, segs: JSON.parse(segsKey) as BarSeg[], ui }, origin);
      }
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.origin !== origin) return;
      const d = e.data as { type?: unknown; ready?: unknown; hotkey?: unknown; active?: unknown; ui?: unknown } | null;
      if (d?.type !== AMBIENT_MSG) return;
      if (d.ready) send();
      if (typeof d.ui === 'number' && Number.isFinite(d.ui)) cb.current.onUi?.(d.ui);
      if (d.active === 0 || d.active === 1) cb.current.onActive?.(d.active === 1);
      if (d.hotkey === 'skip' || d.hotkey === 'next') cb.current.onHotkey?.(d.hotkey);
    };
    window.addEventListener('message', onMsg);
    f.addEventListener('load', send);
    send();
    return () => {
      window.removeEventListener('message', onMsg);
      f.removeEventListener('load', send);
    };
  }, [src, countSec, segsKey, ui]);

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
