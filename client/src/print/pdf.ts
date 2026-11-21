import {
  PDF_DRAW_SCALE, PDF_FONT, PDF_PAGE_SCRIPT, billPdfPages, pdfFromJpegs,
  type Bill, type PdfPage, type ReceiptLabels, type Settings,
} from '@shridhar/shared';

type DrawPage = (ctx: CanvasRenderingContext2D, page: PdfPage, k: number, font: string) => void;

// The same drawing lines the tablet's WebView runs, made into a function once.
let drawPage: DrawPage | null = null;
function drawer(): DrawPage {
  if (!drawPage) drawPage = new Function(PDF_PAGE_SCRIPT + '\nreturn drawPdfPage;')() as DrawPage;
  return drawPage;
}

/** The bill as an A4 PDF: each page drawn on a canvas, then packed as a picture per page. */
export async function billPdf(bill: Bill, settings: Settings, labels: ReceiptLabels): Promise<Blob> {
  // Kannada drawn before its font has arrived comes out in boxes.
  try {
    await document.fonts.load('16px "Noto Sans Kannada"', 'ಕ');
    await document.fonts.ready;
  } catch { /* the system font will do */ }
  const draw = drawer();
  const images: { jpeg: Uint8Array; width: number; height: number }[] = [];
  for (const page of billPdfPages(bill, settings, labels)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.w * PDF_DRAW_SCALE);
    canvas.height = Math.round(page.h * PDF_DRAW_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the bill');
    draw(ctx, page, PDF_DRAW_SCALE, PDF_FONT);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('This browser would not turn the bill into a PDF');
    images.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  return new Blob([pdfFromJpegs(images) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
