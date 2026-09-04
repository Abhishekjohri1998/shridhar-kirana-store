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
  total: string;
  paid: string;
  balance: string;
};

export const EN_RECEIPT_LABELS: ReceiptLabels = {
  bill: 'Bill #',
  name: 'Name',
  phone: 'Phone',
  total: 'TOTAL',
  paid: 'Paid',
  balance: 'Balance',
};
