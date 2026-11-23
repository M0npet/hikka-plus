import { DEFAULT_SETTINGS, updateSettings, type ReaderSettings, type TapScheme } from '../../core/store';
import { tapZone } from './views';
import type { ContentFormat } from '../../sources/types';
import { IconClose, IconReset } from '../../ui/icons';
import { Button, Field, Select, Slider, SwitchRow, Tabs } from '../../ui/kit';

type NovelS = ReaderSettings['novel'];
type MangaS = ReaderSettings['manga'];

const setNovel = (p: Partial<NovelS>) => updateSettings((s) => ({ ...s, novel: { ...s.novel, ...p } }));
const setManga = (p: Partial<MangaS>) => updateSettings((s) => ({ ...s, manga: { ...s.manga, ...p } }));

/** Поля тексту (ранобе) — спільні для панелі читалки й вікна налаштувань розширення. */
export function NovelFields({ n }: { n: NovelS }) {
  return (
    <>
      <Field label="Тема">
        <Select
          size="lg"
          value={n.theme}
          options={[
            { value: 'site', label: 'Як на Hikka' },
            { value: 'dark', label: 'Темна' },
            { value: 'sepia', label: 'Сепія' },
            { value: 'light', label: 'Світла' },
          ]}
          onChange={(theme) => setNovel({ theme })}
        />
      </Field>
      <Field label="Шрифт">
        <Select
          size="lg"
          value={n.font}
          options={[
            { value: 'site', label: 'Як на Hikka' },
            { value: 'serif', label: 'З засічками' },
            { value: 'sans', label: 'Без засічок' },
            { value: 'mono', label: 'Моноширинний' },
          ]}
          onChange={(font) => setNovel({ font })}
        />
      </Field>
      <Slider label="Розмір тексту" value={n.fontSize} min={12} max={32} format={(v) => `${v}px`} onChange={(fontSize) => setNovel({ fontSize })} />
      <Slider label="Міжрядковий інтервал" value={n.lineHeight} min={1.2} max={2.4} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => setNovel({ lineHeight })} />
      <Slider label="Ширина тексту" value={n.width} min={480} max={1400} step={20} format={(v) => `${v}px`} onChange={(width) => setNovel({ width })} />
      <Slider label="Відступ між абзацами" value={n.paragraphGap} min={0} max={2} step={0.1} format={(v) => `${v.toFixed(1)}em`} onChange={(paragraphGap) => setNovel({ paragraphGap })} />
      <SwitchRow label="Вирівнювання по ширині" hint="Рівний правий край тексту" checked={n.justify} onChange={(justify) => setNovel({ justify })} />
      <SwitchRow label="Червоний рядок" hint="Відступ на початку абзацу" checked={n.indent} onChange={(indent) => setNovel({ indent })} />
    </>
  );
}

type ModeKey = 'modeManga' | 'modeWebtoon';

/** Схема зон 3×3: що робить клік у кожній частині. */
function ZoneMap({ scheme }: { scheme: TapScheme }) {
  const cells = [1 / 6, 1 / 2, 5 / 6].flatMap((y) => [1 / 6, 1 / 2, 5 / 6].map((x) => tapZone(scheme, x, y)));
  return (
    <div className="hp-zonemap" aria-hidden="true">
      {cells.map((d, i) => (
        <span key={i} className={`hp-zonemap__c hp-zonemap__c--${d < 0 ? 'prev' : d > 0 ? 'next' : 'menu'}`}>
          {d < 0 ? 'Назад' : d > 0 ? 'Далі' : i === 4 ? 'Меню' : ''}
        </span>
      ))}
    </div>
  );
}

/** Поля зображень (манґа/манхва); modes — які режими за замовчуванням показати і з якими підписами. */
type WidthKey = 'width' | 'widthWebtoon';
const WIDTH_LABEL: Record<WidthKey, string> = { width: 'Ширина (манґа)', widthWebtoon: 'Ширина (манхва)' };

export function MangaFields({
  m,
  modes,
  widths = ['width', 'widthWebtoon'],
}: {
  m: MangaS;
  modes: [ModeKey, string][];
  /** Які повзунки ширини показати; один — підпис просто «Ширина». */
  widths?: WidthKey[];
}) {
  return (
    <>
      {modes.map(([key, label]) => (
        <Field key={key} label={label}>
          <Tabs
            value={m[key]}
            options={[
              ['vertical', 'Стрічка'],
              ['paged', 'Посторінково'],
            ]}
            onChange={(v) => setManga({ [key]: v })}
          />
        </Field>
      ))}
      {/* Напрям діє лише на посторінкове гортання; у стрічці (манхва) він нічого не змінює — не показуємо. */}
      {modes.some(([key]) => m[key] === 'paged') && (
        <Field label="Напрям гортання" hint="Лише в режимі «Посторінково»">
          <Tabs
            value={m.rtl}
            options={[
              [false, 'Зліва направо'],
              [true, 'Справа наліво'],
            ]}
            onChange={(rtl) => setManga({ rtl })}
          />
        </Field>
      )}
      <Field label="Вписувати зображення">
        <Tabs
          value={m.fit}
          options={[
            ['width', 'За шириною'],
            ['height', 'За висотою'],
            ['original', 'Оригінал'],
          ]}
          onChange={(fit) => setManga({ fit })}
        />
      </Field>
      <Field label="Зони кліку й тапу" hint="Середина — показати/сховати панелі">
        <Tabs
          value={m.tapScheme}
          options={[
            ['l', 'L-подібні'],
            ['lr', 'Ліво/право'],
            ['tb', 'Верх/низ'],
            ['off', 'Вимкнено'],
          ]}
          onChange={(tapScheme) => setManga({ tapScheme })}
        />
        {m.tapScheme !== 'off' && <ZoneMap scheme={m.tapScheme} />}
      </Field>
      <Field label="Де працюють зони">
        <Tabs
          value={m.clickArea}
          options={[
            ['image', 'На сторінці'],
            ['screen', 'По всьому екрану'],
          ]}
          onChange={(clickArea) => setManga({ clickArea })}
        />
      </Field>
      <Field label="Якість зображень" hint="Нижча — швидше завантажується">
        <Select
          size="lg"
          value={m.quality}
          options={[
            { value: 'original', label: 'Оригінал' },
            { value: 'high', label: 'Висока' },
            { value: 'medium', label: 'Середня' },
            { value: 'low', label: 'Низька' },
          ]}
          onChange={(quality) => setManga({ quality })}
        />
      </Field>
      {widths.map((k) => (
        <Slider
          key={k}
          label={widths.length > 1 ? WIDTH_LABEL[k] : 'Ширина'}
          value={m[k]}
          min={320}
          max={1600}
          step={20}
          format={(v) => `${v}px`}
          onChange={(v) => setManga({ [k]: v })}
        />
      ))}
      <Slider label="Відступ між сторінками" value={m.gap} min={0} max={48} format={(v) => `${v}px`} onChange={(gap) => setManga({ gap })} />
      <Slider label="Яскравість" value={m.brightness} min={40} max={120} format={(v) => `${v}%`} onChange={(brightness) => setManga({ brightness })} />
      <SwitchRow label="Номер сторінки" hint="Показувати лічильник сторінок унизу" checked={m.pageNumbers} onChange={(pageNumbers) => setManga({ pageNumbers })} />
      <SwitchRow
        label="Безкінечна стрічка"
        hint="Наступний розділ підвантажується одразу під поточним"
        checked={m.endless}
        onChange={(endless) => setManga({ endless })}
      />
      {m.endless && (
        <SwitchRow
          label="Роздільник між розділами"
          hint="Напис «Кінець розділу → наступний» у стрічці; вимкнено — сторінки йдуть суцільно"
          checked={m.feedSep}
          onChange={(feedSep) => setManga({ feedSep })}
        />
      )}
      <Slider
        label="Швидкість автопрокрутки"
        value={m.autoSpeed}
        min={20}
        max={400}
        step={10}
        format={(v) => `${v} px/с`}
        onChange={(autoSpeed) => setManga({ autoSpeed })}
      />
    </>
  );
}

/** Панель налаштувань читалки — за зразком сторінок «Налаштування → Кастомізація» на Hikka. */
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
  const modeKey: ModeKey = format === 'manga' ? 'modeManga' : 'modeWebtoon';

  return (
    <aside className="hp-panel hp-panel--right" aria-label="Налаштування читалки">
      <div className="hp-panel__head">
        <span className="hp-panel__title">Налаштування</span>
        <Button
          variant="ghost"
          size="sm"
          title={format === 'novel' ? 'Скинути налаштування тексту' : 'Скинути налаштування зображень'}
          onClick={() =>
            updateSettings((x) =>
              format === 'novel' ? { ...x, novel: DEFAULT_SETTINGS.novel } : { ...x, manga: DEFAULT_SETTINGS.manga },
            )
          }
        >
          <IconReset />
          Скинути
        </Button>
        <Button variant="ghost" size="sm" icon onClick={onClose} title="Закрити (Esc)" aria-label="Закрити">
          <IconClose />
        </Button>
      </div>
      <div className="hp-panel__body">
        {format === 'novel' ? (
          <NovelFields n={n} />
        ) : (
          <MangaFields m={m} modes={[[modeKey, 'Режим читання']]} widths={[format === 'manga' ? 'width' : 'widthWebtoon']} />
        )}
        <SwitchRow
          label="Ховати панелі при прокрутці"
          hint="З'являються знову при прокрутці вгору або кліку"
          checked={s.autoHideBars}
          onChange={(autoHideBars) => updateSettings((x) => ({ ...x, autoHideBars }))}
        />
        <p className="hp-xs hp-muted hp-p">Клавіші: ← → — сторінка або розділ, Пробіл — пауза автопрокрутки, F — повний екран, Esc — закрити. На телефоні: два пальці — масштаб, подвійний тап — скинути.</p>
      </div>
    </aside>
  );
}
