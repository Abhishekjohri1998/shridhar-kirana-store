import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { buildReceipt, paperProfile, type Bill, type ReceiptDoc, type Settings } from '@shridhar/shared';
import { ReceiptView } from '../components/ReceiptView';
import {
  applyPaperToPrintSheet,
  chooseBluetoothPrinter, chooseSerialPrinter, connectedPrinterName, connectedSerialName,
  isWebBluetoothAvailable, isWebSerialAvailable, loadBaudRate, loadPrintMode,
  printViaBluetooth, printViaSerial, printViaSystem, receiptPng, saveBaudRate, savePrintMode,
  type PrintMode,
} from '../print';
import { useShop } from './useShop';

type PrintApi = {
  mode: PrintMode;
  setMode: (mode: PrintMode) => void;
  busy: boolean;

  bluetoothAvailable: boolean;
  bluetoothPrinter: string | null;
  connectBluetooth: () => Promise<void>;

  serialAvailable: boolean;
  serialPrinter: string | null;
  connectSerial: () => Promise<void>;
  baudRate: number;
  setBaudRate: (rate: number) => void;

  /** Renders the receipt and sends it to whichever printer the shop is set up for. */
  printBill: (bill: Bill, settings: Settings) => Promise<void>;
  /** Hands a picture of the slip to the browser's share sheet, or saves it if there is none. */
  shareBill: (bill: Bill, settings: Settings) => Promise<void>;
};

const Ctx = createContext<PrintApi | null>(null);

export function PrintProvider({ children }: { children: ReactNode }) {
  const shop = useShop();
  const [doc, setDoc] = useState<ReceiptDoc | null>(null);
  const [mode, setModeState] = useState<PrintMode>(() => loadPrintMode());
  const [busy, setBusy] = useState(false);
  const [bluetoothPrinter, setBluetoothPrinter] = useState<string | null>(() => connectedPrinterName());
  const [serialPrinter, setSerialPrinter] = useState<string | null>(() => connectedSerialName());
  const [baudRate, setBaudRateState] = useState<number>(() => loadBaudRate());

  const paper = paperProfile(shop.settings.paper);

  // The print stylesheet has to describe the roll the shop actually loads, and that is a setting.
  useEffect(() => {
    applyPaperToPrintSheet(paper);
  }, [paper]);

  const setMode = useCallback((next: PrintMode) => {
    setModeState(next);
    savePrintMode(next);
  }, []);

  const setBaudRate = useCallback((rate: number) => {
    setBaudRateState(rate);
    saveBaudRate(rate);
  }, []);

  const connectBluetooth = useCallback(async () => {
    const name = await chooseBluetoothPrinter();
    setBluetoothPrinter(name);
    setMode('bluetooth');
  }, [setMode]);

  const connectSerial = useCallback(async () => {
    const name = await chooseSerialPrinter(baudRate);
    setSerialPrinter(name);
    setMode('serial');
  }, [baudRate, setMode]);

  const printBill = useCallback(
    async (bill: Bill, settings: Settings) => {
      const built = buildReceipt(bill, settings, shop.receiptLabels);
      setBusy(true);
      // Mounted into #print-root either way: the system path prints that element, and having it
      // in hidden markup costs nothing on the direct paths.
      setDoc(built);
      try {
        if (mode === 'bluetooth') await printViaBluetooth(built);
        else if (mode === 'serial') await printViaSerial(built);
        else await printViaSystem();
      } finally {
        setBusy(false);
      }
    },
    [mode, shop.receiptLabels],
  );

  /**
   * A picture of the slip, shared or saved.
   *
   * The same document the printer gets, so what reaches a customer's phone is what came out of
   * the machine -- handwriting included, which is why this is an image and not a typed summary.
   *
   * navigator.share with a file is the good path and it exists on Android Chrome, which is what
   * the counter would use. Where it does not -- a desktop browser, or one that will not take
   * files -- the picture is saved instead, and the shopkeeper attaches it themselves. Failing
   * outright because the browser is the wrong one would be the worst of the three.
   */
  const shareBill = useCallback(
    async (bill: Bill, settings: Settings) => {
      setBusy(true);
      try {
        const blob = await receiptPng(buildReceipt(bill, settings, shop.receiptLabels));
        const name = 'bill-' + bill.no + '.png';
        const file = new File([blob], name, { type: 'image/png' });

        const canShareFile =
          typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
        if (canShareFile) {
          await navigator.share({ files: [file], title: shop.t('hist.billNo', { no: bill.no }) });
          return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        // Revoked on the next turn, so the click has had the URL before it goes.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } finally {
        setBusy(false);
      }
    },
    [shop],
  );

  const value = useMemo<PrintApi>(
    () => ({
      mode, setMode, busy,
      bluetoothAvailable: isWebBluetoothAvailable(),
      bluetoothPrinter,
      connectBluetooth,
      serialAvailable: isWebSerialAvailable(),
      serialPrinter,
      connectSerial,
      baudRate,
      setBaudRate,
      printBill,
      shareBill,
    }),
    [mode, setMode, busy, bluetoothPrinter, connectBluetooth, serialPrinter, connectSerial, baudRate, setBaudRate, printBill, shareBill],
  );

  const printRoot = typeof document === 'undefined' ? null : document.getElementById('print-root');

  return (
    <Ctx.Provider value={value}>
      {children}
      {doc && printRoot ? createPortal(<ReceiptView doc={doc} forPrint inkAlt={shop.t('ink.alt')} />, printRoot) : null}
    </Ctx.Provider>
  );
}

export function usePrint(): PrintApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('usePrint must be used inside PrintProvider');
  return api;
}
