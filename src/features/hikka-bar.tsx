import { useEffect, useState } from 'react';
import { logoutHikka, authErrorItem } from '../core/hikka-auth';
import { chapterKey, getBinding, patchBinding } from '../core/store';
import {
  autoSyncItem,
  loadRemoteRead,
  setHikkaChapters,
  startHikkaLogin,
  useHikkaAuth,
  useRemoteRead,
} from './hikka-sync';
import { markReadUpTo, maxReadLocal, type TitleState } from './title-state';

const STATUS: Record<string, string> = {
  reading: 'Читаю',
  completed: 'Прочитано',
  planned: 'Заплановано',
  on_hold: 'Відкладено',
  dropped: 'Закинуто',
};

/** Рядок синхронізації зі списком Hikka під прогресом тайтлу. */
export function HikkaSyncBar({ state: s }: { state: TitleState }) {
  const auth = useHikkaAuth();
  const remote = useRemoteRead();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const { kind, slug } = s.page;

  useEffect(() => {
    let alive = true;
    void getBinding(kind, slug).then((b) => alive && setDismissed(b.hikkaDismissed ?? null));
    return () => {
      alive = false;
    };
  }, [kind, slug]);

  // Після входу — одразу підтягнути стан списку.
  useEffect(() => {
    if (auth.connected && !remote) void loadRemoteRead(kind, slug);
  }, [auth.connected, remote, kind, slug]);

  if (!auth.configured) return null;

  if (!auth.connected) {
    return (
      <div className="hp-hikka">
        <span className="hp-grow hp-small hp-muted">
          {auth.error ?? 'Синхронізуй прочитане зі своїм списком на Hikka'}
        </span>
        <button type="button" className="hp-btn hp-small" onClick={() => void startHikkaLogin()}>
          Підключити Hikka
        </button>
      </div>
    );
  }

  const here = remote && remote.kind === kind && remote.slug === slug ? remote : null;
  const hikkaN = here?.status === 'ok' ? (here.read?.chapters ?? 0) : 0;
  const localN = maxReadLocal(s.progress);
  // Розділи до hikkaN, які тут ще не позначені прочитаними.
  const behind =
    hikkaN > 0 &&
    dismissed !== hikkaN &&
    Object.values(s.sources).some((st) =>
      st.chapters.some((c) => {
        const n = Number.parseFloat(c.number.replace(',', '.'));
        return Number.isFinite(n) && n <= hikkaN && !s.progress.chapters[chapterKey(c.number)]?.read;
      }),
    );

  const info =
    here?.status === 'loading'
      ? 'Hikka: завантажую…'
      : here?.status === 'none'
        ? 'Hikka: тайтла немає у твоєму списку'
        : here?.status === 'error'
          ? `Hikka: помилка (${here.error})`
          : here?.read
            ? `Hikka: ${STATUS[here.read.status] ?? here.read.status} · ${here.read.chapters} розд.`
            : 'Hikka: підключено';

  return (
    <>
      {auth.error && <div className="hp-hikka hp-small hp-muted">{auth.error}</div>}
      {behind && (
        <div className="hp-hikka hp-hikka--offer">
          <span className="hp-grow hp-small">
            У списку Hikka прочитано <b>{hikkaN}</b> розд. Відмітити 1–{hikkaN} тут?
          </span>
          <button type="button" className="hp-btn hp-small" onClick={() => void markReadUpTo(hikkaN)}>
            Відмітити
          </button>
          <button
            type="button"
            className="hp-btn hp-btn--ghost hp-small"
            onClick={() => {
              setDismissed(hikkaN);
              void patchBinding(kind, slug, (b) => ({ ...b, hikkaDismissed: hikkaN }));
            }}
          >
            Ні
          </button>
        </div>
      )}
      <div className="hp-hikka">
        <span className="hp-grow hp-small hp-muted">{info}</span>
        {localN > hikkaN && here && here.status !== 'loading' && here.status !== 'error' && (
          <button
            type="button"
            className="hp-btn hp-btn--ghost hp-small"
            title="Записати номер останнього прочитаного розділу у твій список Hikka"
            onClick={() => void setHikkaChapters(kind, slug, localN, s.hikka?.chapters ?? null)}
          >
            Записати {localN} у Hikka
          </button>
        )}
        <label className="hp-row hp-small hp-muted" title="Оновлювати лічильник у Hikka, коли дочитуєш розділ">
          <input
            type="checkbox"
            checked={auth.autoSync}
            onChange={(e) => void autoSyncItem.setValue(e.target.checked)}
          />
          авто
        </label>
        <button
          type="button"
          className="hp-btn hp-btn--ghost hp-small"
          title="Відключити Hikka на цьому пристрої"
          onClick={() => {
            void logoutHikka();
            void authErrorItem.setValue(null);
          }}
        >
          Вийти
        </button>
      </div>
    </>
  );
}
