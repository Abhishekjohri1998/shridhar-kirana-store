import Svg, { Path } from 'react-native-svg';
import { inkFit, inkToSvgPath, type Ink } from '@shridhar/shared';

/**
 * Handwriting drawn from the stored strokes. Vectors, so the same ink is sharp in a cart row and
 * on the receipt preview without keeping a second, flattened copy.
 */
export function InkView({
  ink, height, maxWidth, strokeDots, color = '#000',
}: {
  ink: Ink;
  height: number;
  maxWidth: number;
  /** Line weight in the output's own units, before the fit scale is divided back out. */
  strokeDots: number;
  color?: string;
}) {
  const fit = inkFit(ink, maxWidth, height);
  const { box } = fit;
  const viewW = Math.max(1, box.maxX - box.minX);
  const viewH = Math.max(1, box.maxY - box.minY);
  return (
    <Svg
      width={fit.w}
      height={fit.h}
      viewBox={box.minX + ' ' + box.minY + ' ' + viewW + ' ' + viewH}
      preserveAspectRatio="xMinYMid meet"
    >
      <Path
        d={inkToSvgPath(ink)}
        stroke={color}
        strokeWidth={strokeDots / fit.scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
