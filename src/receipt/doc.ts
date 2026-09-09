import type { Bill, Settings } from '../types';
import { lineAmount, money, qtyText } from '../lib/money';

/** 58mm printers have a 384-dot print head. Everything is laid out against that width. */
export const PAPER_WIDTH = 384;

export type Row =
  | { t: 'center'; text: string; size?: number; bold?: boolean }
  | { t: 'kv'; left: string; right: string; size?: number; bold?: boolean }
  | { t: 'item'; qty: string; name: string; amount: string; note?: string }
  | { t: 'sep' }
  | { t: 'space'; h: number };

export type ReceiptDoc = { width: number; rows: Row[] };

/** "03/09/26 9:06 am" -- day-first, the way it is written everywhere else in India. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'am' : 'pm';
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${h12}:${p2(d.getMinutes())} ${ampm}`;
}

/**
 * The one description of what a receipt looks like. The on-screen preview and the thermal
 * printer both render from this, so what the shopkeeper sees is what comes out of the paper.
 */
export function buildReceipt(bill: Bill, settings: Settings): ReceiptDoc {
  const rows: Row[] = [
    { t: 'center', text: settings.shopName, size: 30, bold: true },
    { t: 'space', h: 6 },
    { t: 'kv', left: `Bill #${bill.no}`, right: stamp(bill.at), size: 20 },
    { t: 'sep' },
  ];

  for (const line of bill.lines) {
    rows.push({
      t: 'item',
      qty: qtyText(line.qty),
      name: line.nameKn || line.nameEn,
      amount: money(lineAmount(line.qty, line.rate)),
      note: settings.showRate ? `@ ${money(line.rate)}` : undefined,
    });
  }

  rows.push(
    { t: 'sep' },
    { t: 'kv', left: 'TOTAL', right: money(bill.total), size: 30, bold: true },
    { t: 'sep' },
    { t: 'space', h: 8 },
    { t: 'center', text: settings.footer, size: 22 },
    { t: 'space', h: 10 },
  );

  return { width: PAPER_WIDTH, rows };
}

export function billTotal(lines: Bill['lines']): number {
  return lines.reduce((sum, l) => sum + lineAmount(l.qty, l.rate), 0);
}
