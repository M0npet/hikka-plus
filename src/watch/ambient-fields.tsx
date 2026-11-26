import { Slider } from '../ui/kit';
import { DEFAULT_AMBIENT_BRIGHT, DEFAULT_AMBIENT_LEVEL, DEFAULT_MENU_LEVEL, type WatchPrefs } from './watch-store';

/**
 * Повзунки підсвітки — спільні для шестерні блоку «Перегляд» і вкладки «Плеєр» у вікні налаштувань.
 * Прозорість (MK 15:52, 16:07) — окремо від яскравості кольорів.
 */
export function AmbientFields({ prefs, onPrefs }: { prefs: WatchPrefs; onPrefs: (p: Partial<WatchPrefs>) => void }) {
  return (
    <GlowSliders
      level={prefs.ambientLevel ?? DEFAULT_AMBIENT_LEVEL}
      bright={prefs.ambientBright ?? DEFAULT_AMBIENT_BRIGHT}
      onLevel={(ambientLevel) => onPrefs({ ambientLevel })}
      onBright={(ambientBright) => onPrefs({ ambientBright })}
    />
  );
}

/** Прозорість меню над плеєром (MK 2026-11-26 16:59) — у шестерні блоку «Перегляд» і на вкладці «Плеєр». */
export function MenuOpacityField({ prefs, onPrefs }: { prefs: WatchPrefs; onPrefs: (p: Partial<WatchPrefs>) => void }) {
  return (
    <Slider
      label="Прозорість меню"
      value={100 - (prefs.menuLevel ?? DEFAULT_MENU_LEVEL)}
      min={0}
      max={90}
      step={5}
      format={(v) => `${v}%`}
      onChange={(t) => onPrefs({ menuLevel: 100 - t })}
    />
  );
}

/** Ті самі два повзунки без прив'язки до сховища — і для підсвітки читалки. level — непрозорість 0..100. */
export function GlowSliders({
  level,
  bright,
  onLevel,
  onBright,
}: {
  level: number;
  bright: number;
  onLevel: (level: number) => void;
  onBright: (bright: number) => void;
}) {
  return (
    <>
      <Slider
        label="Прозорість підсвітки"
        value={100 - level}
        min={0}
        max={90}
        step={5}
        format={(v) => `${v}%`}
        onChange={(t) => onLevel(100 - t)}
      />
      <Slider
        label="Яскравість підсвітки"
        value={bright}
        min={50}
        max={200}
        step={10}
        format={(v) => `${v}%`}
        onChange={onBright}
      />
    </>
  );
}
