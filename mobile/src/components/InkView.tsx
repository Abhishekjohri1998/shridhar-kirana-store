import Svg, { Path } from 'react-native-svg';
import { inkBounds, inkToSvgPath, type Ink } from '@shridhar/shared';

/**
 * Handwriting drawn from the stored strokes. Vectors, so the same ink is sharp in a cart row and
 * on the receipt preview without keeping a second, flattened copy.
 *
 * `scale` and `originY` come from the slip's plan, not from this line's own box: fitting each
 * line to the row height on its own is what printed a short word as large as a tall one, and a
 * shared origin is what puts them all on one baseline. Sizes in the plan are printer dots, so
 * `dot` converts them to the pixels this preview is drawn at.
 */
export function InkView({
  ink, scale, originY, dot, strokeDots, color = '#000',
}: {
  ink: Ink;
  /** Printer dots per ink unit, shared by every hand-written line on the slip. */
  scale: number;
  /** Top of the union of every line's bounds, in ink units. */
  originY: number;
  /** Screen pixels per printer dot. */
  dot: number;
  /** Line weight in printer dots, before the scale is divided back out. */
  strokeDots: number;
  color?: string;
}) {
  const box = inkBounds(ink);
  const viewW = Math.max(1, box.maxX - box.minX);
  const viewH = Math.max(1, box.maxY - originY);
  return (
    <Svg
      width={viewW * scale * dot}
      height={viewH * scale * dot}
      viewBox={box.minX + ' ' + originY + ' ' + viewW + ' ' + viewH}
      preserveAspectRatio="xMinYMid meet"
    >
      <Path
        d={inkToSvgPath(ink)}
        stroke={color}
        strokeWidth={strokeDots / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
