import type { SVGProps } from 'react';

// Мінімальний набір іконок (стиль Lucide, MIT), щоб не тягнути залежність.
const base = (d: string[]) =>
  function Icon(p: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="hp-icon"
        aria-hidden="true"
        {...p}
      >
        {d.map((x) => (
          <path key={x} d={x} />
        ))}
      </svg>
    );
  };

export const IconBook = base([
  'M12 7v14',
  'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
]);
export const IconClose = base(['M18 6 6 18', 'm6 6 12 12']);
export const IconLeft = base(['m15 18-6-6 6-6']);
export const IconRight = base(['m9 18 6-6-6-6']);
export const IconList = base(['M3 6h18', 'M3 12h18', 'M3 18h18']);
export const IconSettings = base([
  'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
  'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
]);
export const IconExpand = base([
  'M8 3H5a2 2 0 0 0-2 2v3',
  'M21 8V5a2 2 0 0 0-2-2h-3',
  'M3 16v3a2 2 0 0 0 2 2h3',
  'M16 21h3a2 2 0 0 0 2-2v-3',
]);
export const IconSort = base(['m3 16 4 4 4-4', 'M7 20V4', 'm21 8-4-4-4 4', 'M17 4v16']);
export const IconSearch = base(['m21 21-4.34-4.34', 'M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0']);
export const IconExternal = base(['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6']);
export const IconCheck = base(['M20 6 9 17l-5-5']);
export const IconLink = base([
  'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
  'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
]);
export const IconReset = base(['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5']);
export const IconPlay = base(['M6 4v16l14-8z']);
export const IconPause = base(['M8 5v14', 'M16 5v14']);
export const IconEye = base([
  'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0',
  'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
]);
/** Перекреслене око (Lucide eye-off) — серія ще не переглянута. */
export const IconEyeOff = base([
  'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
  'M14.084 14.158a3 3 0 0 1-4.242-4.242',
  'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
  'm2 2 20 20',
]);
export const IconHeart = base([
  'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
]);
export const IconShrink = base(['M8 3v3a2 2 0 0 1-2 2H3', 'M21 8h-3a2 2 0 0 1-2-2V3', 'M3 16h3a2 2 0 0 1 2 2v3', 'M16 21v-3a2 2 0 0 1 2-2h3']);
export const IconBulb = base([
  'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
  'M9 18h6',
  'M10 22h4',
]);
/** Розмір плеєра як у Mikai (MK 2026-11-24): на всю ширину вікна / на всю висоту / вирівняти по екрану. */
export const IconMoveH = base(['m18 8 4 4-4 4', 'M2 12h20', 'm6 8-4 4 4 4']);
export const IconMoveV = base(['m8 18 4 4 4-4', 'M12 2v20', 'm8 6 4-4 4 4']);
export const IconMoveBack = base(['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11']);
export const IconScan = base(['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0']);
export const IconTv = base(['M7 21h10', 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z']);
