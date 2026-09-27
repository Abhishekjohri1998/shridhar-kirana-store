/**
 * The five section icons.
 *
 * Drawn on one 24-unit grid with one stroke weight, so they read as a family rather than as five
 * clip-art choices. They matter more than decoration here: half the point of an icon in a shop
 * tool is that the owner's son, or whoever is minding the counter that afternoon, can find the
 * right tab without reading the label.
 */

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

/** A paper slip with a torn foot: the thing this app produces. */
export function BillIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3.5h12v15.7l-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3Z" />
      <path d="M9.2 8h5.6M9.2 11.4h5.6M9.2 14.8h3.2" />
    </svg>
  );
}

/** A sack of stock. */
export function ItemsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 3.5h5l-1.2 2.7c2.9 1.1 4.9 3.9 4.9 7.2 0 4-2.8 7.1-6.2 7.1S5.8 17.4 5.8 13.4c0-3.3 2-6.1 4.9-7.2Z" />
      <path d="M10.3 6.2h3.4" />
    </svg>
  );
}

/** Two people: the khata is kept per customer. */
export function CustomersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9.6" cy="8.2" r="3.3" />
      <path d="M3.7 19.6c0-3.1 2.6-5.3 5.9-5.3s5.9 2.2 5.9 5.3" />
      <path d="M16.2 5.6a3.2 3.2 0 0 1 0 6M17.6 14.7c1.7.7 2.8 2.3 2.8 4.4" />
    </svg>
  );
}

/** A clock turned back. */
export function HistoryIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
      <path d="M3.4 3.9v4.3h4.3" />
      <path d="M12 7.9V12l2.9 1.8" />
    </svg>
  );
}

/** A dial, not a cog: fewer teeth, less noise at 20px. */
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 7.2h11M18.6 7.2H20M4 16.8h4.4M12 16.8h8" />
      <circle cx="16.6" cy="7.2" r="2.3" />
      <circle cx="10.1" cy="16.8" r="2.3" />
    </svg>
  );
}

export const SECTION_ICONS = {
  '/bill': BillIcon,
  '/items': ItemsIcon,
  '/customers': CustomersIcon,
  '/history': HistoryIcon,
  '/settings': SettingsIcon,
} as const;
