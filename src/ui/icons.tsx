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
