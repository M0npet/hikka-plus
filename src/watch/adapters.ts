/*
 * Позиція в плеєрах через їхній власний postMessage-API (свої скрипти у фрейми не вставляємо).
 * Розвідка — claude/research-player.md:
 *  - Ashdi (PlayerJS): сам шле {event, time|data|answer}; запити {api:'time'|'duration'} → {event, answer};
 *    перемотка {api:'seek', set}. Події реклами vast_* ігноруємо.
 *  - Moon (ns 'ma', v2): iframe з ?api=1 → {ns:'ma', event:'bridge_ready'}; команда subscribe → події timeupdate,
 *    ended, quartile; get_duration, get_skip_segments, player_seek {seek}. Відповідь {ns:'ma', id, status, data}.
 *  - Fenix: сам шле {fenix:true, event: ready|loaded|timeupdate|ended|episode_change, time, duration, episode};
 *    команди {action, value}. Мітки OP/ED (markers_change, skip_change) Fenix шле лише сайту AniHub (FENIX_TV_API
 *    видає тільки їхня сторінка; перевірено 2026-11-25) — тому їх читає наш скрипт у фреймі зі смужки прокрутки
 *    (.fenix-marker-intro/-ending) і шле {type: AMBIENT_MSG, marks} (entrypoints/player-frame.content.ts).
 *  - Свій плеєр (відкритий протокол Hikka Plus): {hp:1, event:'timeupdate'|'ended', time, duration, episode?}.
 * Повідомлення приймаємо лише від contentWindow свого iframe.
 */
import { AMBIENT_MSG, type PlayerKind } from './types';
import { segsFromPlayer, type Seg } from './skip-marks';

export type PlayerEvents = {
  onTime: (time: number, duration: number) => void;
  onEnded: () => void;
  /** Мітки OP/ED самого плеєра (сек), якщо плеєр їх дає. */
  onSegs: (segs: { op?: Seg; ed?: Seg }) => void;
  /** Плеєр сам перемкнув серію (Fenix: свій список і автоперехід). */
  onEpisode?: (n: number) => void;
};

export type PlayerControl = { seek: (sec: number) => void; detach: () => void };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : NaN);

export function attachPlayer(frame: HTMLIFrameElement, kind: PlayerKind, ev: PlayerEvents): PlayerControl {
  const origin = (() => {
    try {
      return new URL(frame.src).origin;
    } catch {
      return '';
    }
  })();
  let duration = 0;
  let reqId = 0;
  const post = (msg: unknown) => frame.contentWindow?.postMessage(msg, origin || '*');
  const moon = (command: string, data?: Record<string, unknown>) => post({ ns: 'ma', v: 2, id: `hp${++reqId}`, command, ...data });
  const segs = (data: unknown) => {
    const m = segsFromPlayer(data);
    if (m.op || m.ed) ev.onSegs(m);
  };
  const time = (t: number, d?: number) => {
    if (d && d > 0) duration = d;
    if (t >= 0 && duration > 0) ev.onTime(t, duration);
  };

  const onMsg = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow) return;
    if (origin && e.origin !== origin && kind !== 'custom') return;
    let m: unknown = e.data;
    if (typeof m === 'string') {
      try {
        m = JSON.parse(m);
      } catch {
        return;
      }
    }
    if (!m || typeof m !== 'object') return;
    const o = m as Record<string, unknown>;
    // Мітки від нашого скрипту у фреймі (Fenix) — уже в секундах, перевіряємо й передаємо як є.
    if (o.type === AMBIENT_MSG) {
      const mk = o.marks as Record<string, { s?: unknown; e?: unknown } | undefined> | undefined;
      if (!mk || typeof mk !== 'object') return;
      const out: { op?: Seg; ed?: Seg } = {};
      for (const k of ['op', 'ed'] as const) {
        const s = num(mk[k]?.s);
        const e = num(mk[k]?.e);
        if (s >= 0 && e > s) out[k] = { s, e };
      }
      if (out.op || out.ed) ev.onSegs(out);
      return;
    }
    const d = (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>;

    if (kind === 'ashdi') {
      const evn = String(o.event ?? '');
      if (evn.startsWith('vast')) return;
      const v = num(o.answer ?? o.data ?? o.time);
      if (evn === 'duration' && v > 0) duration = v;
      else if (evn === 'time' && v >= 0) time(v);
      else if (evn === 'end' || evn === 'ended') ev.onEnded();
      else if (evn === 'inited' || evn === 'start' || evn === 'play') post({ api: 'duration' });
    } else if (kind === 'moon') {
      if (o.ns !== 'ma') return;
      const evn = String(o.event ?? '');
      if (evn === 'bridge_ready' || evn === 'ready') {
        moon('subscribe');
        moon('get_duration');
        moon('get_skip_segments');
        return;
      }
      if (evn === 'timeupdate') time(num(d.time ?? o.time), num(d.duration ?? o.duration));
      else if (evn === 'ended' || (evn === 'quartile' && num(d.percent ?? o.percent) === 100)) ev.onEnded();
      else if (evn === 'skip_available') segs(d.segments ?? d);
      else if (o.id && o.status !== 'error') {
        // Відповіді на наші команди.
        const dur = num(d.duration ?? o.data);
        if (dur > 0 && !duration) duration = dur;
        segs(d.segments ?? o.data);
      }
    } else if (kind === 'fenix') {
      if (o.fenix !== true) return;
      const evn = String(o.event ?? '');
      if (evn === 'timeupdate' || evn === 'loaded') time(num(o.time), num(o.duration));
      else if (evn === 'ended') ev.onEnded();
      else if (evn === 'episode_change') {
        const n = num(o.episode);
        if (n > 0) ev.onEpisode?.(n);
      } else if (evn === 'skip_change') segs(o.skips ?? o.segments ?? o.value ?? o.data);
    } else if (o.hp === 1) {
      const evn = String(o.event ?? '');
      if (evn === 'timeupdate') time(num(o.time), num(o.duration));
      else if (evn === 'ended') ev.onEnded();
      const ed = num(o.edStart);
      if (ed > 0) ev.onSegs({ ed: { s: ed, e: NaN } });
    }
  };
  window.addEventListener('message', onMsg);

  // Ashdi не завжди сам шле час — питаємо раз на 2 с. Moon міг надіслати bridge_ready до підписки — повторюємо.
  const timers: ReturnType<typeof setInterval>[] = [];
  if (kind === 'ashdi') timers.push(setInterval(() => post({ api: 'time' }), 2000));
  if (kind === 'moon') {
    const once = setTimeout(() => {
      moon('subscribe');
      moon('get_duration');
      moon('get_skip_segments');
    }, 2500);
    timers.push(once as unknown as ReturnType<typeof setInterval>);
  }

  return {
    seek: (sec) => {
      if (!(sec > 0)) return;
      if (kind === 'ashdi') post({ api: 'seek', set: sec });
      else if (kind === 'moon') moon('player_seek', { seek: sec, data: { seek: sec } }); // формат параметра не підтверджено — шлемо обидва
      else if (kind === 'fenix') post({ action: 'player_seek', value: sec });
      else post({ hp: 1, command: 'seek', time: sec });
    },
    detach: () => {
      window.removeEventListener('message', onMsg);
      timers.forEach((t) => {
        clearInterval(t);
        clearTimeout(t);
      });
    },
  };
}
