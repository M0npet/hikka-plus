import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS, updateSettings, type ReaderSettings } from '../../core/store';
import type { ContentFormat } from '../../sources/types';
import { IconClose } from '../../ui/icons';

type NovelS = ReaderSettings['novel'];
type MangaS = ReaderSettings['manga'];

const setNovel = (p: Partial<NovelS>) => updateSettings((s) => ({ ...s, novel: { ...s.novel, ...p } }));
const setManga = (p: Partial<MangaS>) => updateSettings((s) => ({ ...s, manga: { ...s.manga, ...p } }));

function Seg<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="hp-seg" role="group">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Range(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="hp-set">
      <div className="hp-set__label">
        <span>{props.label}</span>
        <span>
          {props.value}
          {props.unit}
        </span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

const Set = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="hp-set">
    <div className="hp-set__label">{label}</div>
    {children}
  </div>
);

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="hp-set hp-switch">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsPanel({
  settings: s,
  format,
  onClose,
}: {
  settings: ReaderSettings;
  format: ContentFormat;
  onClose: () => void;
}) {
  const n = s.novel;
  const m = s.manga;
  const modeKey = format === 'manga' ? 'modeManga' : 'modeWebtoon';

  return (
    <aside className="hp-panel hp-panel--right" aria-label="Налаштування читалки">
      <div className="hp-panel__head">
        <span className="hp-grow">Налаштування</span>
        <button type="button" className="hp-btn hp-btn--ghost hp-btn--icon" onClick={onClose} title="Закрити">
          <IconClose />
        </button>
      </div>
      <div className="hp-panel__body">
        {format === 'novel' ? (
          <>
            <Set label="Тема">
              <Seg
                value={n.theme}
                options={[
                  ['site', 'Як Hikka'],
                  ['dark', 'Темна'],
                  ['sepia', 'Сепія'],
                  ['light', 'Світла'],
                ]}
                onChange={(theme) => setNovel({ theme })}
              />
            </Set>
            <Set label="Шрифт">
              <Seg
                value={n.font}
                options={[
                  ['site', 'Сайту'],
                  ['serif', 'Засічки'],
                  ['sans', 'Без засічок'],
                  ['mono', 'Моно'],
                ]}
                onChange={(font) => setNovel({ font })}
              />
            </Set>
            <Range label="Розмір тексту" value={n.fontSize} min={12} max={32} unit="px" onChange={(fontSize) => setNovel({ fontSize })} />
            <Range label="Міжрядковий інтервал" value={n.lineHeight} min={1.2} max={2.4} step={0.05} onChange={(lineHeight) => setNovel({ lineHeight })} />
            <Range label="Ширина тексту" value={n.width} min={480} max={1400} step={20} unit="px" onChange={(width) => setNovel({ width })} />
            <Range label="Відступ між абзацами" value={n.paragraphGap} min={0} max={2} step={0.1} unit="em" onChange={(paragraphGap) => setNovel({ paragraphGap })} />
            <Switch label="Вирівнювання по ширині" checked={n.justify} onChange={(justify) => setNovel({ justify })} />
            <Switch label="Червоний рядок" checked={n.indent} onChange={(indent) => setNovel({ indent })} />
          </>
        ) : (
          <>
            <Set label="Режим читання">
              <Seg
                value={m[modeKey]}
                options={[
                  ['vertical', 'Стрічка'],
                  ['paged', 'Посторінково'],
                ]}
                onChange={(v) => setManga({ [modeKey]: v })}
              />
            </Set>
            <Set label="Напрям гортання">
              <Seg
                value={m.rtl}
                options={[
                  [false, 'Зліва направо'],
                  [true, 'Справа наліво'],
                ]}
                onChange={(rtl) => setManga({ rtl })}
              />
            </Set>
            <Set label="Вписувати зображення">
              <Seg
                value={m.fit}
                options={[
                  ['width', 'За шириною'],
                  ['height', 'За висотою'],
                  ['original', 'Оригінал'],
                ]}
                onChange={(fit) => setManga({ fit })}
              />
            </Set>
            <Set label="Перемикання сторінок кліком">
              <Seg
                value={m.clickArea}
                options={[
                  ['image', 'По зображенню'],
                  ['screen', 'По всьому екрану'],
                ]}
                onChange={(clickArea) => setManga({ clickArea })}
              />
            </Set>
            <Range label="Ширина" value={m.width} min={400} max={1600} step={20} unit="px" onChange={(width) => setManga({ width })} />
            <Range label="Відступ між сторінками" value={m.gap} min={0} max={48} unit="px" onChange={(gap) => setManga({ gap })} />
            <Range label="Яскравість" value={m.brightness} min={40} max={120} unit="%" onChange={(brightness) => setManga({ brightness })} />
            <Set label="Якість зображень">
              <Seg
                value={m.quality}
                options={[
                  ['original', 'Оригінал'],
                  ['high', 'Висока'],
                  ['medium', 'Середня'],
                  ['low', 'Низька'],
                ]}
                onChange={(quality) => setManga({ quality })}
              />
            </Set>
            <Switch label="Номер сторінки" checked={m.pageNumbers} onChange={(pageNumbers) => setManga({ pageNumbers })} />
          </>
        )}
        <Switch
          label="Ховати панелі при прокрутці"
          checked={s.autoHideBars}
          onChange={(autoHideBars) => updateSettings((x) => ({ ...x, autoHideBars }))}
        />
        <div style={{ paddingTop: 16 }}>
          <button
            type="button"
            className="hp-btn"
            onClick={() =>
              updateSettings((x) =>
                format === 'novel' ? { ...x, novel: DEFAULT_SETTINGS.novel } : { ...x, manga: DEFAULT_SETTINGS.manga },
              )
            }
          >
            Скинути за замовчуванням
          </button>
        </div>
        <p className="hp-small hp-muted" style={{ marginTop: 16 }}>
          Клавіші: ← → — сторінка або розділ, F — повний екран, Esc — закрити.
        </p>
      </div>
    </aside>
  );
}
