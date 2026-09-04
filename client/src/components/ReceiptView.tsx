import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  INK_ROW_HEIGHT, INK_STROKE_DOTS, inkFit, inkMaxWidth, inkToSvgPath,
  type Ink, type ReceiptDoc,
} from '@shridhar/shared';

/** Sizes are printer dots. `--dot` converts them: screen pixels on screen, millimetres in the
 *  print stylesheet, so the preview and the paper cannot drift apart. */
const dots = (n: number) => 'calc(var(--dot) * ' + n + ')';

function textStyle(size: number, bold?: boolean): CSSProperties {
  return { fontSize: dots(size), lineHeight: 1.5, fontWeight: bold ? 700 : 400 };
}

/**
 * Handwriting as SVG rather than a bitmap: the browser rasterises the vectors at whatever
 * resolution the target has, which is what makes the same strokes come out sharp on a phone
 * screen and on the print head.
 */
function InkMark({ ink, paperDots, alt }: { ink: Ink; paperDots: number; alt: string }) {
  const fit = inkFit(ink, inkMaxWidth(paperDots), INK_ROW_HEIGHT);
  const { box } = fit;
  const viewW = Math.max(1, box.maxX - box.minX);
  const viewH = Math.max(1, box.maxY - box.minY);
  return (
    <svg
      width={dots(fit.w)}
      height={dots(fit.h)}
      viewBox={box.minX + ' ' + box.minY + ' ' + viewW + ' ' + viewH}
      preserveAspectRatio="xMinYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
      aria-label={alt}
    >
      <path
        d={inkToSvgPath(ink)}
        fill="none"
        stroke="#000"
        // Stroke width is in ink units, so it has to be divided back out by the fitted scale to
        // land on the paper at a predictable thickness.
        strokeWidth={INK_STROKE_DOTS / fit.scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The receipt, rendered from the shared document model. Used for the on-screen preview and,
 * through a portal into #print-root, for the page the printer actually receives.
 *
 * On screen the frame is measured and one dot becomes a fraction of its width, so a 58mm and an
 * 80mm receipt are each drawn to their own scale rather than one being squeezed into the other's
 * width. For the print copy nothing is set inline: the injected `@media print` rule supplies
 * `--dot` in millimetres, and an inline pixel value here would override it.
 */
export function ReceiptView({
  doc,
  forPrint = false,
  inkAlt = 'handwritten item description',
}: {
  doc: ReceiptDoc;
  forPrint?: boolean;
  inkAlt?: string;
}) {
  /**
   * The outer box is measured; the paper inside it is sized. Keeping those two jobs on separate
   * elements matters: when the measured element also carried the max-width derived from that
   * measurement, the two fed each other and settled on a width one padding too wide, so the
   * amount column hung off the edge of the paper.
   */
  const outer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    if (forPrint) return;
    const box = outer.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // The paper's own border and padding are fixed in CSS and do not depend on the dot size,
      // so taking them off the container's width is safe to do here.
      const paper = frame.current;
      let chrome = 0;
      if (paper) {
        const style = getComputedStyle(paper);
        chrome =
          parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0') +
          parseFloat(style.borderLeftWidth || '0') + parseFloat(style.borderRightWidth || '0');
      }
      setAvailable(Math.max(0, box.clientWidth - chrome));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, [forPrint]);

  // About 0.9 screen pixels per dot when there is room, so the wider roll also looks wider.
  const target = doc.width * 0.9;
  const width = available > 0 ? Math.min(available, target) : target;

  return (
    <div className="receipt-outer" ref={outer}>
      <div
        className={'receipt-frame' + (forPrint ? ' for-print' : '')}
        ref={frame}
        style={forPrint ? undefined : { ['--dot' as string]: width / doc.width + 'px' }}
      >
        <div className="receipt" style={{ width: dots(doc.width) }}>
        {doc.rows.map((row, i) => {
          if (row.t === 'space') return <div key={i} style={{ height: dots(row.h) }} />;
          if (row.t === 'sep') return <div key={i} className="r-sep" />;

          if (row.t === 'center') {
            return (
              <div key={i} className="r-center" style={textStyle(row.size ?? 22, row.bold)}>
                {row.text}
              </div>
            );
          }

          if (row.t === 'kv') {
            return (
              <div key={i} className="r-kv" style={textStyle(row.size ?? 22, row.bold)}>
                <span>{row.left}</span>
                <span>{row.right}</span>
              </div>
            );
          }

          if (row.t === 'ink') {
            return (
              <div key={i} className="r-item" style={textStyle(24)}>
                <span>{row.qty}</span>
                <span className="r-name">
                  <InkMark ink={row.ink} paperDots={doc.width} alt={inkAlt} />
                  {row.note ? (
                    <span className="r-note" style={{ display: 'block', fontSize: dots(18) }}>
                      {row.note}
                    </span>
                  ) : null}
                </span>
                <span className="r-amount">{row.amount}</span>
              </div>
            );
          }

          return (
            <div key={i} className="r-item" style={textStyle(24)}>
              <span>{row.qty}</span>
              <span className="r-name">
                {row.name}
                {row.note ? (
                  <span className="r-note" style={{ display: 'block', fontSize: dots(18) }}>
                    {row.note}
                  </span>
                ) : null}
              </span>
              <span className="r-amount">{row.amount}</span>
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}
