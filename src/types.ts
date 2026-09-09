/** One sellable good. `nameKn` is what gets printed, `nameEn` is what the shopkeeper types to search. */
export type Item = {
  id: string;
  nameKn: string;
  nameEn: string;
  /** Price per unit, in rupees. */
  rate: number;
  /** Free text shown next to the rate: pc, kg, ltr, pkt ... */
  unit: string;
};

/** A line on the bill. Name and rate are copied in, so editing an item later never rewrites old bills. */
export type BillLine = {
  itemId: string;
  nameKn: string;
  nameEn: string;
  qty: number;
  rate: number;
};

export type Bill = {
  no: number;
  /** ISO timestamp. */
  at: string;
  lines: BillLine[];
  total: number;
};

export type Settings = {
  shopName: string;
  footer: string;
  /** Bluetooth MAC of the paired thermal printer. */
  printerAddress: string | null;
  printerName: string | null;
  /** Print the per-unit rate under each item name. The paper slip does not, so this is off by default. */
  showRate: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'Shridhar Kirani Stores',
  footer: 'Thank you, Visit again!',
  printerAddress: null,
  printerName: null,
  showRate: false,
};
