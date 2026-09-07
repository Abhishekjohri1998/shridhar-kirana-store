import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { buildReceipt, type Bill, type Settings } from '@shridhar/shared';
import { RasterBridge, type RasterHandle } from '../print/RasterBridge';
import { rasterToEscPos } from '../print/escpos';
import {
  PrinterError, isPrintingAvailable, listPairedPrinters, loadSavedPrinter, printBytes,
  saveSelectedPrinter, type PairedPrinter,
} from '../print/bluetooth';
import { useShop } from './useShop';

type PrintApi = {
  available: boolean;
  busy: boolean;
  printer: PairedPrinter | null;
  choosePrinter: (printer: PairedPrinter | null) => Promise<void>;
  listPrinters: () => Promise<PairedPrinter[]>;
  printBill: (bill: Bill, settings: Settings) => Promise<void>;
  /** Hands a picture of the slip to whatever the phone can share with. */
  shareBill: (bill: Bill, settings: Settings) => Promise<void>;
};

const Ctx = createContext<PrintApi | null>(null);

export function PrintProvider({ children }: { children: ReactNode }) {
  const shop = useShop();
  const raster = useRef<RasterHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [printer, setPrinter] = useState<PairedPrinter | null>(null);

  useEffect(() => {
    let alive = true;
    void loadSavedPrinter().then((saved) => {
      if (alive) setPrinter(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const choosePrinter = useCallback(async (next: PairedPrinter | null) => {
    setPrinter(next);
    await saveSelectedPrinter(next);
  }, []);

  const printBill = useCallback(
    async (bill: Bill, settings: Settings) => {
      if (!printer) throw new PrinterError(shop.t('set.printerNone'));
      if (busy) throw new PrinterError(shop.t('bill.printing'));
      setBusy(true);
      try {
        const doc = buildReceipt(bill, settings, shop.receiptLabels);
        const dots = await raster.current?.rasterize(doc);
        if (!dots) throw new PrinterError('The receipt renderer is not ready yet. Try once more.');
        await printBytes(printer.address, rasterToEscPos(dots));
      } finally {
        setBusy(false);
      }
    },
    [busy, printer, shop],
  );

  /**
   * A picture of the slip, handed to the phone's share sheet.
   *
   * The same document the printer gets, through the same renderer, so what lands in a chat is
   * what came out of the machine -- handwriting included, which is the whole reason this is an
   * image and not a typed summary. Drawn larger than the print head's 384 dots so it is legible
   * on a screen.
   *
   * Written to the cache rather than anywhere permanent: the share sheet needs a file to hand
   * over, and the phone can reclaim it whenever it likes once the sheet has closed.
   */
  const shareBill = useCallback(
    async (bill: Bill, settings: Settings) => {
      if (busy) throw new PrinterError(shop.t('bill.printing'));
      setBusy(true);
      try {
        if (!(await Sharing.isAvailableAsync())) {
          throw new PrinterError(shop.t('hist.cannotShare'));
        }
        const doc = buildReceipt(bill, settings, shop.receiptLabels);
        const picture = await raster.current?.imageOf(doc);
        if (!picture) throw new PrinterError('The receipt renderer is not ready yet. Try once more.');

        const base64 = picture.image.replace(/^data:image\/png;base64,/, '');
        const file = FileSystem.cacheDirectory + 'bill-' + bill.no + '.png';
        await FileSystem.writeAsStringAsync(file, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await Sharing.shareAsync(file, {
          mimeType: 'image/png',
          dialogTitle: shop.t('hist.billNo', { no: bill.no }),
          UTI: 'public.png',
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, shop],
  );

  const value = useMemo<PrintApi>(
    () => ({
      available: isPrintingAvailable(),
      busy,
      printer,
      choosePrinter,
      listPrinters: listPairedPrinters,
      printBill,
      shareBill,
    }),
    [busy, printer, choosePrinter, printBill, shareBill],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <RasterBridge ref={raster} />
    </Ctx.Provider>
  );
}

export function usePrint(): PrintApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('usePrint must be used inside PrintProvider');
  return api;
}
