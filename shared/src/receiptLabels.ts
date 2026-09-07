/**
 * The words the receipt itself prints.
 *
 * These live here rather than with the interface strings because `buildReceipt` is shared code and
 * the slip is the part the customer reads -- if the shopkeeper switches the app to Kannada, the
 * paper has to follow, not just the buttons.
 */
export type ReceiptLabels = {
  bill: string;
  name: string;
  phone: string;
  /** Printed under the shop name, when the shop has entered one. */
  gstin: string;
  /** The three column headings above the item table. */
  no: string;
  item: string;
  price: string;
  /**
   * What the customer owed before this bill. Abbreviated on purpose: it prints inside the item
   * column beside a date, and the full phrase came within a few dots of wrapping onto a second
   * line on a 58mm roll.
   */
  oldBalance: string;
  total: string;
  paid: string;
  balance: string;
};

export const EN_RECEIPT_LABELS: ReceiptLabels = {
  bill: 'Bill #',
  name: 'Name',
  phone: 'Phone',
  gstin: 'GSTIN',
  no: 'No.',
  item: 'Item',
  price: 'Price',
  oldBalance: 'Old bal.',
  total: 'TOTAL',
  paid: 'Paid',
  balance: 'Balance',
};
