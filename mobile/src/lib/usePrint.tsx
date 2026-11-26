import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  billPdfName, billPdfPages, buildReceipt, pdfFromJpegs, receiptAsText, money, pickLang, printSpeedOf, whatsappNumber,
  type Bill, type Settings,
} from '@shridhar/shared';
import { api } from './api';
import { base64ToBytes, bytesToBase64 } from './base64';
import { shareFileToWhatsApp, shareToWhatsApp, whatsAppTakesPdf } from './native';
import { RasterBridge, type RasterHandle } from '../print/RasterBridge';
import { rasterToEscPos } from '../print/escpos';
import { labelBytes, type BarcodeLabel } from '../print/labels';
import {
  PrinterError, connectPrinter, isPrintingAvailable, listPairedPrinters, loadSavedPrinter, printBytes, printerStatus,
  saveSelectedPrinter, type PairedPrinter,
} from '../print/bluetooth';

/** What the Bill screen's printer chip says. */
export type PrinterState = 'none' | 'checking' | 'connected' | 'disconnected' | 'off';
import { useShop } from './useShop';

type PrintApi = {
  available: boolean;
  busy: boolean;
  printer: PairedPrinter | null;
  choosePrinter: (printer: PairedPrinter | null) => Promise<void>;
  listPrinters: () => Promise<PairedPrinter[]>;
  printBill: (bill: Bill, settings: Settings) => Promise<void>;
  /** Hands the bill, as an A4 PDF, to whatever the phone can share with. */
  shareBill: (bill: Bill, settings: Settings) => Promise<void>;
  /**
   * The bill's PDF straight into the customer's WhatsApp chat; the shopkeeper taps Send. A build
   * before 90 cannot hand WhatsApp a PDF, and sends the slip's picture as it always did.
   * Falls back to the share sheet when WhatsApp is not installed or the build lacks the module.
   */
  whatsappBill: (bill: Bill, settings: Settings) => Promise<void>;
  /** Whether the chosen printer is connected, checked every little while. */
  printerState: PrinterState;
  /** The chip's tap: connect now (or check again). */
  connectNow: () => Promise<void>;
  /** Barcode labels from the Stock tab, on the receipt printer. */
  printLabels: (labels: BarcodeLabel[], copies: number) => Promise<void>;
};

const Ctx = createContext<PrintApi | null>(null);

export function PrintProvider({ children }: { children: ReactNode }) {
  const shop = useShop();
  const raster = useRef<RasterHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [printer, setPrinter] = useState<PairedPrinter | null>(null);
  const [printerState, setPrinterState] = useState<PrinterState>('none');

  // Checked now and every 20 seconds: a printer switched off or out of range shows at once.
  useEffect(() => {
    if (!printer) { setPrinterState('none'); return; }
    let alive = true;
    const check = () => { void printerStatus(printer.address).then((s) => { if (alive) setPrinterState(s); }); };
    setPrinterState('checking');
    check();
    const timer = setInterval(check, 20000);
    return () => { alive = false; clearInterval(timer); };
  }, [printer]);

  const connectNow = useCallback(async () => {
    if (!printer) return;
    setPrinterState('checking');
    try {
      await connectPrinter(printer.address);
    } catch { /* the state below says how it went */ }
    setPrinterState(await printerStatus(printer.address));
  }, [printer]);

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
        const speed = printSpeedOf(settings);
        // A typed English bill goes out as the printer's own text: no image, prints at once.
        // Handwriting or Kannada anywhere needs the picture.
        let bytes = receiptAsText(doc);
        if (!bytes) {
          const dots = await raster.current?.rasterize(doc);
          if (!dots) throw new PrinterError('The receipt renderer is not ready yet. Try once more.');
          bytes = rasterToEscPos(dots, speed);
        }
        await printBytes(printer.address, bytes, speed);
        setPrinterState('connected');
      } finally {
        setBusy(false);
      }
    },
    [busy, printer, shop],
  );

  /**
   * The bill as an A4 PDF in the cache, ready to share: billPdfPages drawn in the receipt
   * WebView, a picture per page. Replaces the slip picture, which a forty-line bill turned into
   * a strip too thin to read.
   */
  const printLabels = useCallback(async (labels: BarcodeLabel[], copies: number) => {
    if (!printer) throw new PrinterError(shop.t('set.printerNone'));
    if (busy) throw new PrinterError(shop.t('bill.printing'));
    setBusy(true);
    try {
      const speed = printSpeedOf(shop.settings);
      await printBytes(printer.address, labelBytes(labels, copies, speed), speed);
      setPrinterState('connected');
    } finally {
      setBusy(false);
    }
  }, [busy, printer, shop]);

  const writePdf = useCallback(async (bill: Bill, settings: Settings): Promise<string> => {
    const handle = raster.current;
    if (!handle) throw new PrinterError('The receipt renderer is not ready yet. Try once more.');
    const drawn = await handle.pdfPages(billPdfPages(bill, settings, shop.receiptLabels));
    const pdf = pdfFromJpegs(drawn.map((p) => ({ jpeg: base64ToBytes(p.jpeg), width: p.w, height: p.h })));
    const file = FileSystem.cacheDirectory + billPdfName(bill);
    await FileSystem.writeAsStringAsync(file, bytesToBase64(pdf), { encoding: FileSystem.EncodingType.Base64 });
    return file;
  }, [shop]);

  /**
   * The slip as a picture (kept for WhatsApp on builds before 90).
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
        const file = await writePdf(bill, settings);
        await Sharing.shareAsync(file, {
          mimeType: 'application/pdf',
          dialogTitle: (bill.kind === 'quotation' ? shop.t('hist.quoteNo', { no: bill.no }) : shop.t('hist.billNo', { no: bill.no })),
          UTI: 'com.adobe.pdf',
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, shop, writePdf],
  );

  const whatsappBill = useCallback(
    async (bill: Bill, settings: Settings) => {
      if (busy) throw new PrinterError(shop.t('bill.printing'));
      // The customer's WhatsApp number lives on their record, not on the bill's frozen copy.
      let number = bill.customer ? whatsappNumber(bill.customer) : '';
      if (bill.customer) {
        try {
          const detail = await api.getCustomer(bill.customer.id);
          number = whatsappNumber(detail.customer) || number;
        } catch { /* the bill's own copy of the phone will do */ }
      }
      setBusy(true);
      let file = '';
      try {
        const text = pickLang(settings.shopName, settings.shopNameKn, shop.lang) + ' · '
          + (bill.kind === 'quotation' ? shop.t('hist.quoteNo', { no: bill.no }) : shop.t('hist.billNo', { no: bill.no })) + ' · ' + money(bill.total);
        // The PDF where this build can hand WhatsApp one; the slip's picture where it cannot.
        const pdf = whatsAppTakesPdf();
        if (pdf) {
          file = await writePdf(bill, settings);
        } else {
          const doc = buildReceipt(bill, settings, shop.receiptLabels);
          const picture = await raster.current?.imageOf(doc);
          if (!picture) throw new PrinterError('The receipt renderer is not ready yet. Try once more.');
          file = FileSystem.cacheDirectory + (bill.kind === 'quotation' ? 'quotation-' : 'bill-') + bill.no + '.png';
          await FileSystem.writeAsStringAsync(file, picture.image.replace(/^data:image\/png;base64,/, ''), {
            encoding: FileSystem.EncodingType.Base64,
          });
        }
        try {
          if (pdf) await shareFileToWhatsApp(number, file, text, 'application/pdf');
          else await shareToWhatsApp(number, file, text);
          return;
        } catch {
          // No WhatsApp, or a build without the module: the ordinary share sheet below.
        }
        if (!(await Sharing.isAvailableAsync())) throw new PrinterError(shop.t('wa.failed'));
        await Sharing.shareAsync(file, {
          mimeType: pdf ? 'application/pdf' : 'image/png',
          dialogTitle: number ? shop.t('wa.send') : shop.t('wa.noNumber'),
          UTI: pdf ? 'com.adobe.pdf' : 'public.png',
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, shop, writePdf],
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
      whatsappBill,
      printerState,
      connectNow,
      printLabels,
    }),
    [busy, printer, choosePrinter, printBill, shareBill, whatsappBill, printerState, connectNow, printLabels],
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
