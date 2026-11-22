import { useEffect } from 'react';
import { logoutHikka, authErrorItem } from '../core/hikka-auth';
import { chapterKey } from '../core/store';
import {
  autoSyncItem,
  loadRemoteRead,
  setHikkaChapters,
  startHikkaLogin,
  useHikkaAuth,
  useRemoteRead,
} from './hikka-sync';
import { markReadUpTo, maxReadLocal, type TitleState } from './title-state';
import { Button, Switch } from '../ui/kit';

const STATUS: Record<string, string> = {
  reading: 'Читаю',
  completed: 'Прочитано',
  planned: 'Заплановано',
  on_hold: 'Відкладено',
  dropped: 'Закинуто',
};

/** Числа Hikka, які вже звіряли з прогресом тут (`kind:slug:N`). */
const seenHikkaN = new Set<string>();

/** Рядок синхронізації зі списком Hikka під прогресом тайтлу. */
export function HikkaSyncBar({ state: s }: { state: TitleState }) {
  const auth = useHikkaAuth();
  const remote = useRemoteRead();
  const { kind, slug } = s.page;

  // Після входу — одразу підтягнути стан списку.
  useEffect(() => {
    if (auth.connected && !remote) void loadRemoteRead(kind, slug);
  }, [auth.connected, remote, kind, slug]);

  const here = remote && remote.kind === kind && remote.slug === slug ? remote : null;
  const hikkaN = here?.status === 'ok' ? (here.read?.chapters ?? 0) : 0;
  // Розділи до hikkaN, які тут ще не позначені прочитаними.
  const behind =
    hikkaN > 0 &&
    Object.values(s.sources).some((st) =>
      st.chapters.some((c) => {
        const n = Number.parseFloat(c.number.replace(',', '.'));
        return Number.isFinite(n) && n <= hikkaN && !s.progress.chapters[chapterKey(c.number)]?.read;
      }),
    );
  // У списку Hikka прочитано більше — одразу відмічаємо 1–N тут, без питання (рішення MK).
  // Лише коли це число Hikka для тайтлу бачимо вперше: якщо користувач потім зніме галочку
  // (а Hikka ще не встигла зменшитись), не повертаємо її.
  useEffect(() => {
    if (hikkaN <= 0) return;
    const key = `${kind}:${slug}:${hikkaN}`;
    if (seenHikkaN.has(key)) return;
    seenHikkaN.add(key);
    if (behind) void markReadUpTo(hikkaN);
  }, [behind, kind, slug, hikkaN]);

  if (!auth.configured) return null;

  if (!auth.connected) {
    return (
      <div className="hp-hikka">
        <span className="hp-grow hp-small hp-muted">
          {auth.error ?? 'Синхронізуй прочитане зі своїм списком на Hikka'}
        </span>
        <Button variant="secondary" size="sm" onClick={() => void startHikkaLogin()}>
          Підключити Hikka
        </Button>
      </div>
    );
  }

  const localN = maxReadLocal(s.progress);

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
      <div className="hp-hikka">
        <span className="hp-grow hp-small hp-muted">{info}</span>
        {localN > hikkaN && here && here.status !== 'loading' && here.status !== 'error' && (
          <Button
            variant="ghost"
            size="sm"
            title="Записати номер останнього прочитаного розділу у твій список Hikka"
            onClick={() => void setHikkaChapters(kind, slug, localN, s.hikka?.chapters ?? null)}
          >
            Записати {localN} у Hikka
          </Button>
        )}
        <span className="hp-row hp-small hp-muted" title="Оновлювати лічильник у Hikka, коли дочитуєш розділ">
          <Switch
            label="Автоматично оновлювати лічильник у Hikka"
            checked={auth.autoSync}
            onChange={(v) => void autoSyncItem.setValue(v)}
          />
          Авто
        </span>
        <Button
          variant="ghost"
          size="sm"
          title="Відключити Hikka на цьому пристрої"
          onClick={() => {
            void logoutHikka();
            void authErrorItem.setValue(null);
          }}
        >
          Вийти
        </Button>
      </div>
    </>
  );
}
