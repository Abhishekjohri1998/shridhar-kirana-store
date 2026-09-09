import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { buildReceipt } from '../receipt/doc';
import { RasterBridge, type RasterHandle } from '../receipt/RasterBridge';
import { useStore } from '../store/store';
import type { Bill } from '../types';
import { rasterToEscPos } from './escpos';
import { PrinterError, isPrintingAvailable, printBytes } from './bluetooth';

type PrintApi = {
  busy: boolean;
  available: boolean;
  /** Renders and prints. Throws a message fit to show the shopkeeper. */
  printBill: (bill: Bill) => Promise<void>;
};

const Ctx = createContext<PrintApi | null>(null);

export function PrintProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useStore();
  const raster = useRef<RasterHandle | null>(null);
  const [busy, setBusy] = useState(false);

  const printBill = useCallback(
    async (bill: Bill) => {
      if (!settings.printerAddress) {
        throw new PrinterError('No printer chosen yet. Pick one under Settings.');
      }
      if (busy) throw new PrinterError('Still printing the last bill');
      setBusy(true);
      try {
        const doc = buildReceipt(bill, settings);
        const bitmap = await raster.current?.rasterize(doc);
        if (!bitmap) throw new PrinterError('The receipt renderer is not ready yet. Try once more.');
        await printBytes(settings.printerAddress, rasterToEscPos(bitmap));
      } finally {
        setBusy(false);
      }
    },
    [busy, settings],
  );

  return (
    <Ctx.Provider value={{ busy, available: isPrintingAvailable(), printBill }}>
      {children}
      <RasterBridge ref={raster} />
    </Ctx.Provider>
  );
}

export function usePrinter(): PrintApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('usePrinter must be used inside PrintProvider');
  return api;
}
