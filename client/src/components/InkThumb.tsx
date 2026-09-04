import { inkFit, inkToSvgPath, type Ink } from '@shridhar/shared';

/**
 * Small preview of handwriting, for the cart and the customer list. Drawn from the same stroke
 * data the receipt uses, so what the shopkeeper checks on screen is what will print.
 */
export function InkThumb({ ink, height = 30, alt }: { ink: Ink; height?: number; alt: string }) {
  const fit = inkFit(ink, height * 8, height);
  const { box } = fit;
  const viewW = Math.max(1, box.maxX - box.minX);
  const viewH = Math.max(1, box.maxY - box.minY);
  return (
    <svg
      width={Math.round(fit.w)}
      height={Math.round(fit.h)}
      viewBox={box.minX + ' ' + box.minY + ' ' + viewW + ' ' + viewH}
      preserveAspectRatio="xMinYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
      aria-label={alt}
    >
      <path
        d={inkToSvgPath(ink)}
        fill="none"
        stroke="currentColor"
        // In ink units, so it has to be divided back out by the fitted scale.
        strokeWidth={2 / fit.scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
