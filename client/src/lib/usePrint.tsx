import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { buildReceipt, paperProfile, type Bill, type ReceiptDoc, type Settings } from '@shridhar/shared';
import { ReceiptView } from '../components/ReceiptView';
import {
  applyPaperToPrintSheet,
  chooseBluetoothPrinter, chooseSerialPrinter, connectedPrinterName, connectedSerialName,
  isWebBluetoothAvailable, isWebSerialAvailable, loadBaudRate, loadPrintMode,
  printViaBluetooth, printViaSerial, printViaSystem, saveBaudRate, savePrintMode,
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
    }),
    [mode, setMode, busy, bluetoothPrinter, connectBluetooth, serialPrinter, connectSerial, baudRate, setBaudRate, printBill],
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
