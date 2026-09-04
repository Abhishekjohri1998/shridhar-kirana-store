import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

  const value = useMemo<PrintApi>(
    () => ({
      available: isPrintingAvailable(),
      busy,
      printer,
      choosePrinter,
      listPrinters: listPairedPrinters,
      printBill,
    }),
    [busy, printer, choosePrinter, printBill],
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
