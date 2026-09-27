import Svg, { Circle, Path } from 'react-native-svg';
import { C } from '../theme';

/**
 * The same five section icons as the web app, on the same 24-unit grid at the same stroke weight,
 * redrawn in react-native-svg. Half the point of an icon here is that whoever is minding the
 * counter that afternoon can find the right tab without reading the label.
 */

type Props = { size?: number; color?: string };

function frame(size: number) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const };
}

const stroke = { strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** A paper slip with a torn foot: the thing this app produces. */
export function BillIcon({ size = 22, color = C.soft }: Props) {
  return (
    <Svg {...frame(size)}>
      <Path
        d="M6 3.5h12v15.7l-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3Z"
        stroke={color}
        {...stroke}
      />
      <Path d="M9.2 8h5.6M9.2 11.4h5.6M9.2 14.8h3.2" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A sack of stock. */
export function ItemsIcon({ size = 22, color = C.soft }: Props) {
  return (
    <Svg {...frame(size)}>
      <Path
        d="M9.5 3.5h5l-1.2 2.7c2.9 1.1 4.9 3.9 4.9 7.2 0 4-2.8 7.1-6.2 7.1S5.8 17.4 5.8 13.4c0-3.3 2-6.1 4.9-7.2Z"
        stroke={color}
        {...stroke}
      />
      <Path d="M10.3 6.2h3.4" stroke={color} {...stroke} />
    </Svg>
  );
}

/** Two people: the khata is kept per customer. */
export function CustomersIcon({ size = 22, color = C.soft }: Props) {
  return (
    <Svg {...frame(size)}>
      <Circle cx="9.6" cy="8.2" r="3.3" stroke={color} {...stroke} />
      <Path d="M3.7 19.6c0-3.1 2.6-5.3 5.9-5.3s5.9 2.2 5.9 5.3" stroke={color} {...stroke} />
      <Path d="M16.2 5.6a3.2 3.2 0 0 1 0 6M17.6 14.7c1.7.7 2.8 2.3 2.8 4.4" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A clock turned back. */
export function HistoryIcon({ size = 22, color = C.soft }: Props) {
  return (
    <Svg {...frame(size)}>
      <Path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" stroke={color} {...stroke} />
      <Path d="M3.4 3.9v4.3h4.3" stroke={color} {...stroke} />
      <Path d="M12 7.9V12l2.9 1.8" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A dial, not a cog: fewer teeth, less noise at 20px. */
export function SettingsIcon({ size = 22, color = C.soft }: Props) {
  return (
    <Svg {...frame(size)}>
      <Path d="M4 7.2h11M18.6 7.2H20M4 16.8h4.4M12 16.8h8" stroke={color} {...stroke} />
      <Circle cx="16.6" cy="7.2" r="2.3" stroke={color} {...stroke} />
      <Circle cx="10.1" cy="16.8" r="2.3" stroke={color} {...stroke} />
    </Svg>
  );
}

/** The wordmark's glyph: an open ledger, ruled and ticked. */
export function Mark({ size = 26, color = C.accent }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M16 8.4C13.6 6.4 10.6 5.4 6.5 5.4A1.5 1.5 0 0 0 5 6.9v16.7a1.5 1.5 0 0 0 1.5 1.5c4.1 0 7.1 1 9.5 3 2.4-2 5.4-3 9.5-3a1.5 1.5 0 0 0 1.5-1.5V6.9a1.5 1.5 0 0 0-1.5-1.5c-4.1 0-7.1 1-9.5 3Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path d="M16 8.4v19.7" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8.8 12.6h4.1M8.8 17.1h4.1" stroke={color} strokeWidth={1.6} strokeLinecap="round" opacity={0.55} />
      <Path d="M19.4 15.2l2.1 2.2 4-4.4" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const SECTION_ICONS = {
  bill: BillIcon,
  customers: CustomersIcon,
  history: HistoryIcon,
  settings: SettingsIcon,
} as const;
