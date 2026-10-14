"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Camera, Minus, Plus, ScanBarcode, Trash2, Search, Star, CheckCircle2, X, Monitor, Scale, Smartphone, Hash, Volume2, VolumeX } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ReceiptActions } from "@/components/ReceiptActions";
import { ReturnPanel, type ReturnDraftLine } from "@/components/ReturnPanel";
import { CameraScannerModal } from "@/components/CameraScannerModal";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useProducts } from "@/hooks/useProducts";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { api, ApiError, describeApiError } from "@/lib/api";
import { formatMoney, round2 } from "@/lib/format";
import { openReceiptPrint } from "@/lib/print";
import { effectivePrice, quoteSale } from "@/lib/quote";
import { postDisplay } from "@/lib/display";
import { paymentSoundEnabled, playPaymentConfirmation, setPaymentSoundEnabled } from "@/lib/paymentSound";
import { readScaleKg, scaleSupported } from "@/lib/scale";
import { SerialPrompt } from "@/components/pos/SerialPrompt";
import { UpiQr } from "@/components/pos/UpiQr";
import { CustomerDisplayLink } from "@/components/pos/CustomerDisplayLink";
import { TerminalCharge } from "@/components/pos/TerminalCharge";
import { ShareActions } from "@/components/pos/ShareActions";
import { paymentMethodKey } from "@/lib/enumLabels";
import type { CartItem, Customer, Invoice, PaymentMethod, Product } from "@/lib/types";

const FRACTIONAL_UNITS = ["KGS", "GMS", "LTR", "MLT", "MTR", "CMS", "SQM", "CBM"];
const isFractional = (p: Product) => !p.trackSerial && !!p.unit && FRACTIONAL_UNITS.includes(p.unit.toUpperCase());
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export default function PosPage() {
  const { data: shop } = useShopSettings();
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [duePaid, setDuePaid] = useState("");
  const [returnLines, setReturnLines] = useState<ReturnDraftLine[]>([]);
  const [refundMode, setRefundMode] = useState<"CASH" | "CREDIT">("CASH");
  const [useCredit, setUseCredit] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "amount" | null>(null);
  const [discountValue, setDiscountValue] = useState(0);
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [upiUri, setUpiUri] = useState<string | null>(null);
  const [displayLinkOpen, setDisplayLinkOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => setSoundOn(paymentSoundEnabled()), []);
  const [amountPaid, setAmountPaid] = useState("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [completedSale, setCompletedSale] = useState<{ id: number; invoiceNumber: string; totalAmount: number } | null>(
    null
  );
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [serialFor, setSerialFor] = useState<Product | null>(null);
  const [gstin, setGstin] = useState("");
  const [payCurrency, setPayCurrency] = useState("");
  const [terminalPaymentId, setTerminalPaymentId] = useState<string | null>(null);
  const [scaleBusy, setScaleBusy] = useState<number | null>(null);
  const { data: fx } = useQuery({ queryKey: ["fx"], queryFn: () => api.get<{ base: string; rates: Record<string, number> }>("/payments/fx"), staleTime: 60_000 });
  const fxCodes = Object.keys(fx?.rates ?? {});
  const fxRate = payCurrency && fx?.rates[payCurrency] ? fx.rates[payCurrency] : 0;

  // Manual add — the fallback for when the barcode scanner isn't working: type
  // a product name or barcode and pick from the matches. Debounced so we don't
  // hit the API on every keystroke; setState lives in the timeout callback (not
  // the effect body) to satisfy the React Compiler lint rules.
  const [manualQuery, setManualQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setCommittedQuery(manualQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [manualQuery]);
  const { data: manualResults } = useProducts(committedQuery);

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);

  const quote = useMemo(
    () => quoteSale({ cart, discountType, discountValue, pointsRedeemed, settings: shop }),
    [cart, discountType, discountValue, pointsRedeemed, shop]
  );

  // Old due the cashier is folding into this bill (capped at what's owed).
  const dueToClear = customer ? Math.min(Math.max(0, Number(duePaid) || 0), customer.totalDue) : 0;

  // Returns queued on this bill and their refund value.
  const returnTotal = round2(returnLines.reduce((s, l) => s + l.refundAmount, 0));
  const creditAvail = customer?.creditBalance ?? 0;
  // Store credit only ever reduces what's payable — never enough to create a
  // refund on its own — so cap it at the sale-minus-returns amount.
  const creditUse = useCredit ? round2(Math.min(creditAvail, Math.max(0, quote.total - returnTotal))) : 0;

  // Net the returns and credit against the sale. Positive → the customer pays;
  // negative → the shop owes them (refund).
  const netBill = round2(quote.total - returnTotal - creditUse);
  const payable = Math.max(0, netBill);
  const grossRefund = Math.max(0, round2(-netBill));

  // Mirrors backend/src/routes/invoices.js exactly: every source of money on
  // this bill (tendered cash, and any gross refund from returns/credit) goes
  // into one pool, allocated goods first, then the old due, then whatever's
  // left is change/refund. Without pooling the refund in here too, this
  // preview showed the FULL return value as "refund" even when some of it
  // was about to go straight to clearing the customer's due — a cashier
  // reading that number had no way to tell the due-clear had actually worked.
  const tenderedCash = paymentMethod === "CASH" ? Number(amountPaid) || 0 : payable + dueToClear;
  const pool = round2(tenderedCash + grossRefund);
  const amountAppliedToGoods = round2(Math.min(pool, payable));
  const afterGoods = round2(Math.max(0, pool - amountAppliedToGoods));
  const duePaidFinal = round2(Math.min(dueToClear, afterGoods));
  const leftover = round2(Math.max(0, afterGoods - duePaidFinal));
  const changeDue = grossRefund > 0 ? 0 : leftover;
  const refundValue = grossRefund > 0 ? leftover : 0;

  // "Paid in full" convenience total: goods + due, assuming the cashier
  // brings fresh cash rather than drawing the due-clear out of a refund.
  const collectTotal = round2(payable + dueToClear);
  const shortNow =
    paymentMethod === "CASH" && Number(amountPaid) > 0 && grossRefund === 0
      ? Math.max(0, round2(collectTotal - (Number(amountPaid) || 0)))
      : 0;

  const addToCart = useCallback(
    (product: Product, serial?: string) => {
      setCompletedSale(null);
      // Serial/IMEI-tracked products are added by unit: scanning an IMEI adds
      // that exact unit; scanning the model's barcode asks for the IMEI(s).
      const asksSerial = Boolean(shop?.serialTracking && product.trackSerial);
      if (asksSerial && !serial) {
        setSerialFor(product);
        return;
      }
      setCart((prev) => {
        const existing = prev.find((item) => item.product.id === product.id);
        if (asksSerial && serial) {
          if (existing?.serials?.includes(serial)) {
            show(t("pos.serialAlready", { serial }), "error");
            return prev;
          }
          if (!existing) return [...prev, { product, quantity: 1, serials: [serial] }];
          return prev.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1, serials: [...(i.serials ?? []), serial] } : i));
        }
        if (!existing) return [...prev, { product, quantity: 1 }];
        if (!shop?.allowNegativeStock && existing.quantity + 1 > product.stock + 1e-9) {
          show(t("pos.onlyInStock", { count: r3(product.stock), name: product.name }), "error");
          return prev;
        }
        return prev.map((item) => (item.product.id === product.id ? { ...item, quantity: r3(item.quantity + 1) } : item));
      });
    },
    [show, shop?.allowNegativeStock, shop?.serialTracking, t]
  );

  const handleScan = useCallback(
    async (code: string) => {
      try {
        // One lookup resolves a barcode or an external SKU.
        const r = await api.get<{ type: "product"; product: Product }>(`/products/scan/${encodeURIComponent(code)}`);
        addToCart(r.product);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Not a product: an NFC loyalty card tap types its UID like a scanner.
          try {
            const c = await api.get<Customer>(`/customers/by-card/${encodeURIComponent(code)}`);
            setCustomer(c);
            setCustomerName(c.name);
            setCustomerPhone(c.phone);
            show(t("pos.pointsToast", { name: c.name, points: c.loyaltyPoints }), "success");
            return;
          } catch {
            /* fall through */
          }
          show(t("pos.nothingMatches"), "error");
        } else show(t("pos.lookupFailed"), "error");
      }
    },
    [addToCart, show, t]
  );

  async function lookupCustomer(phoneOverride?: string) {
    const phone = (phoneOverride ?? customerPhone).trim();
    if (!phone) return;
    try {
      const c = await api.get<Customer>(`/customers/phone/${encodeURIComponent(phone)}`);
      setCustomer(c);
      setCustomerName(c.name);
      setDuePaid("");
      show(t("pos.pointsToast", { name: c.name, points: c.loyaltyPoints }), "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setCustomer(null);
        show(t("pos.newCustomer"), "info");
      } else {
        show(t("pos.customerLookupFailed"), "error");
      }
    }
  }

  // A return is often the FIRST thing typed on a bill — the cashier may
  // never touch the phone field at all. Without this, "Store credit" and
  // "Use store credit" stay silently disabled (no customer attached) and
  // look like the app just isn't responding to the click.
  function onReturnInvoiceFound(info: { customerPhone: string | null; customerName: string }) {
    if (!info.customerPhone) return;
    setCustomerPhone(info.customerPhone);
    setCustomerName(info.customerName);
    if (customer?.phone !== info.customerPhone) lookupCustomer(info.customerPhone);
  }

  const resetSale = () => {
    setCart([]);
    setCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setDuePaid("");
    setReturnLines([]);
    setRefundMode("CASH");
    setUseCredit(false);
    setDiscountType(null);
    setDiscountValue(0);
    setPointsRedeemed(0);
    setPaymentMethod("CASH");
    setAmountPaid("");
    setGstin("");
    setPayCurrency("");
    setTerminalPaymentId(null);
  };

  // A bill is submittable if it sells something, returns something, or
  // collects a previous due — the last case lets a customer walk in only to
  // pay off their udhaar, with no purchase, straight from the register.
  const canFinalize = cart.length > 0 || returnLines.length > 0 || dueToClear > 0;

  const finalizeSale = useCallback(async () => {
    if (!canFinalize || isCheckingOut) return;
    setIsCheckingOut(true);
    try {
      // Group the flat return lines back by their original invoice.
      const returnsPayload = Object.values(
        returnLines.reduce(
          (acc, l) => {
            (acc[l.invoiceId] ??= { invoiceId: l.invoiceId, items: [] }).items.push({
              invoiceItemId: l.invoiceItemId,
              quantity: l.quantity,
              refundAmount: l.refundAmount,
            });
            return acc;
          },
          {} as Record<number, { invoiceId: number; items: { invoiceItemId: number; quantity: number; refundAmount: number }[] }>
        )
      );

      const submitCheckout = (confirmPassword?: string) =>
        api.post<Invoice>("/invoices", {
          customerName,
          customerPhone,
          items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, ...(item.serials?.length ? { serials: item.serials } : {}) })),
          discountType,
          discountValue: Number(discountValue) || 0,
          pointsRedeemed: Number(pointsRedeemed) || 0,
          paymentMethod,
          amountPaid: paymentMethod === "CASH" ? (payCurrency && fxRate ? round2((Number(amountPaid) || 0) * fxRate) : Number(amountPaid) || 0) : 0,
          ...(gstin.trim() ? { customerGstin: gstin.trim().toUpperCase() } : {}),
          ...(payCurrency && fxRate ? { payCurrency } : {}),
          ...(terminalPaymentId ? { terminalPaymentId } : {}),
          duePaid: dueToClear,
          returns: returnsPayload,
          refundMode,
          creditApplied: creditUse,
          confirmPassword,
        });

      // A return/refund needs the password re-confirmed (see backend's
      // requirePasswordConfirm on POST /invoices) — a plain sale does not,
      // so this only prompts when returnsPayload actually has lines in it.
      const invoice =
        returnsPayload.length > 0
          ? await withPasswordConfirm(t("pos.passwordPrompt"), (confirmPassword) => submitCheckout(confirmPassword))
          : await submitCheckout();
      if (!invoice) return; // cancelled the password prompt

      const parts = [`${invoice.invoiceNumber} · ${money(invoice.totalAmount)}`];
      if (invoice.previousDuePaid > 0) parts.push(t("pos.dueClearedPart", { amount: money(invoice.previousDuePaid) }));
      if (invoice.refundValue > 0)
        parts.push(t("pos.refundedPart", { amount: money(invoice.refundValue), mode: invoice.refundMode === "CREDIT" ? t("pos.storeCredit") : t("pos.cash") }));
      show(`${t("pos.done")} — ${parts.join(" · ")}`, "success");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setCompletedSale({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount });
      const paidCash = invoice.paymentMethod === "CASH";
      // Soundbox-style confirmation: chime for every sale, spoken for UPI/card.
      playPaymentConfirmation(`${money(invoice.totalAmount)}`, !paidCash);
      resetSale();
      // Cash sale + a drawer on the receipt printer: kick it open (best effort).
      if (paidCash && shop?.cashDrawer && shop.autoPrintMethod !== "usb") api.post("/print/drawer").catch(() => {});
      if (shop?.autoPrintReceipt) {
        if (shop.autoPrintMethod === "usb") {
          // Send straight to the USB thermal printer — a plain async request,
          // NOT the modal window.print() dialog. On a Debian till with no
          // browser-configured printer that dialog has nothing to open and
          // freezes the screen after every sale (which showed up as checkout
          // "hanging", especially on store-credit/refund bills); the USB path
          // has no dialog to hang on. Fire-and-forget with a toast on failure
          // so a printer problem never blocks the next customer.
          api.post(`/print/${invoice.id}/usb`).catch((err) =>
            show(err instanceof ApiError ? err.message : t("pos.autoPrintFail"), "error")
          );
        } else {
          // Deferred one tick so the "Sale complete" card is definitely
          // painted before the OS print dialog opens — window.print() is
          // modal in most browsers and pauses the tab, which otherwise can
          // read as the app having frozen mid-checkout instead of having
          // already finished.
          setTimeout(() => openReceiptPrint(invoice.id), 0);
        }
      }
    } catch (err) {
      show(describeApiError(err, t("pos.checkoutFailed")), "error");
    } finally {
      setIsCheckingOut(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, payCurrency, fxRate, terminalPaymentId, shop?.cashDrawer, cart, returnLines, refundMode, creditUse, customerName, customerPhone, discountType, discountValue, pointsRedeemed, paymentMethod, amountPaid, dueToClear, canFinalize, isCheckingOut, queryClient, show, withPasswordConfirm, shop?.autoPrintReceipt, shop?.autoPrintMethod, t]);

  useBarcodeScanner({
    onScan: handleScan,
    onManualEnter: (event) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (editable) return;
      finalizeSale();
    },
  });

  function setQuantity(productId: number, qty: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId || (item.serials && item.serials.length > 0)) return item;
          const q = r3(qty);
          if (q > 0 && !shop?.allowNegativeStock && q > item.product.stock + 1e-9) {
            show(t("pos.onlyInStock", { count: r3(item.product.stock), name: item.product.name }), "error");
            return item;
          }
          return { ...item, quantity: q };
        })
        .filter((item) => item.quantity > 0)
    );
  }
  const updateQuantity = (productId: number, delta: number) => {
    const cur = cart.find((i) => i.product.id === productId);
    if (cur) setQuantity(productId, cur.quantity + delta);
  };

  async function weigh(productId: number) {
    setScaleBusy(productId);
    try {
      setQuantity(productId, await readScaleKg());
    } catch (e) {
      show(e instanceof Error ? e.message : t("pos.couldNotReadScale"), "error");
    } finally {
      setScaleBusy(null);
    }
  }

  // Mirror the cart to the customer-facing display window (if one is open).
  useEffect(() => {
    postDisplay({
      shopName: shop?.shopName ?? "",
      symbol: sym,
      lines: cart.map((i) => ({ name: i.product.name, qty: i.quantity, unit: i.product.unit, price: effectivePrice(i.product), total: round2(effectivePrice(i.product) * i.quantity) })),
      subtotal: quote.subtotal,
      discount: quote.discountAmount,
      tax: quote.taxAmount,
      total: quote.total,
      upiUri: paymentMethod === "UPI" && collectTotal > 0 ? upiUri : null,
      thankYou: cart.length === 0 && !!completedSale,
    });
  }, [cart, quote, shop?.shopName, sym, completedSale, paymentMethod, collectTotal, upiUri]);

  const maxRedeemable = customer && shop?.loyaltyEnabled ? customer.loyaltyPoints : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("pos.title")}</h1>
          <p className="flex items-center gap-1.5 text-sm text-foreground/60">
            <ScanBarcode className="h-4 w-4" aria-hidden="true" />
            {t("pos.subtitle")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDisplayLinkOpen(true)}>
            <Monitor className="h-4 w-4" aria-hidden="true" />
            {t("pos.customerDisplay")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-pressed={soundOn}
            title={t("pos.soundTitle")}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setPaymentSoundEnabled(next);
              if (next) playPaymentConfirmation(money(0).replace(/[\d.,]+/, "test"), false);
            }}
          >
            {soundOn ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
            {soundOn ? t("pos.paymentSoundOn") : t("pos.paymentSoundOff")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setCameraScannerOpen(true)}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            {t("pos.scanWithCamera")}
          </Button>
        </div>
      </div>

      {displayLinkOpen && <CustomerDisplayLink onClose={() => setDisplayLinkOpen(false)} />}
      {cameraScannerOpen && (
        <CameraScannerModal
          onClose={() => setCameraScannerOpen(false)}
          onScan={(code) => {
            setCameraScannerOpen(false);
            handleScan(code);
          }}
        />
      )}

      {serialFor && (
        <SerialPrompt
          product={serialFor}
          existing={cart.find((i) => i.product.id === serialFor.id)?.serials ?? []}
          onClose={() => setSerialFor(null)}
          onDone={(serials) => {
            const product = serialFor;
            setCart((prev) => {
              const rest = prev.filter((i) => i.product.id !== product.id);
              return serials.length ? [...rest, { product, quantity: serials.length, serials }] : rest;
            });
            setSerialFor(null);
          }}
        />
      )}
      {completedSale && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-brand/30 bg-brand/5 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-brand" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {completedSale.invoiceNumber} · {money(completedSale.totalAmount)}
              </p>
              <p className="text-xs text-foreground/60">
                {shop?.autoPrintReceipt ? t("pos.saleCompleteAutoPrint") : t("pos.saleCompleteManual")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ReceiptActions invoiceId={completedSale.id} />
            <ShareActions invoiceId={completedSale.id} />
            <Button type="button" variant="ghost" onClick={() => setCompletedSale(null)}>
              {t("pos.dismiss")}
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Cart */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-foreground">{t("pos.cart")}</h2>

          {/* Manual add — the scanner fallback. Always visible so a cashier can
              still bill by typing a product name or barcode when the barcode
              scanner is unplugged, dead, or the code won't scan. */}
          <div className="relative mb-4">
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-foreground/40" aria-hidden="true" />
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder={t("pos.manualPlaceholder")}
                aria-label={t("pos.manualAria")}
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
              />
              {manualQuery && (
                <button
                  type="button"
                  aria-label={t("pos.clearSearch")}
                  onClick={() => setManualQuery("")}
                  className="text-foreground/40 hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            {committedQuery && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
                {!manualResults ? (
                  <p className="px-3 py-2.5 text-sm text-foreground/50">{t("pos.searching")}</p>
                ) : manualResults.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm text-foreground/50">{t("pos.noMatch", { query: committedQuery })}</p>
                ) : (
                  manualResults.slice(0, 8).map((p) => {
                    const outOfStock = p.stock <= 0 && !shop?.allowNegativeStock;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={outOfStock}
                        onClick={() => {
                          addToCart(p);
                          setManualQuery("");
                          setCommittedQuery("");
                        }}
                        className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {p.name}
                          {p.barcode && <span className="ml-1.5 font-normal text-foreground/40">· {p.barcode}</span>}
                        </span>
                        <span className="shrink-0 text-foreground/70">{money(effectivePrice(p))}</span>
                        <span className={`shrink-0 text-xs ${outOfStock ? "text-danger" : "text-foreground/40"}`}>
                          {outOfStock ? t("pos.outOfStock") : t("pos.inStock", { count: r3(p.stock) })}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {cart.length === 0 ? (
            <p className="py-10 text-center text-sm text-foreground/50">{t("pos.cartEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase text-foreground/50">
                    <th className="py-2 pr-4">{t("pos.colItem")}</th>
                    <th className="py-2 pr-4">{t("pos.colQty")}</th>
                    <th className="py-2 pr-4 text-right">{t("pos.colPrice")}</th>
                    {shop?.gstEnabled && <th className="py-2 pr-4 text-right">{t("pos.colGst")}</th>}
                    <th className="py-2 pr-4 text-right">{t("pos.colTotal")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cart.map((item) => (
                    <tr key={item.product.id}>
                      <td className="py-2.5 pr-4 font-medium text-foreground">
                        {item.product.name}
                        {item.product.unit && <span className="ml-1.5 font-normal text-foreground/40">({item.product.unit})</span>}
                        {item.serials && item.serials.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.serials.map((sn) => (
                              <span key={sn} className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[11px] font-normal text-brand">
                                <Hash className="h-3 w-3" aria-hidden="true" />
                                {sn}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        {item.serials && item.serials.length > 0 ? (
                          <button type="button" onClick={() => setSerialFor(item.product)} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-muted">
                            {t("pos.editUnits", { count: item.quantity })}
                          </button>
                        ) : isFractional(item.product) ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              step="0.001"
                              aria-label={t("pos.qtyAria", { name: item.product.name })}
                              value={item.quantity}
                              onChange={(e) => setQuantity(item.product.id, Number(e.target.value) || 0)}
                              className="tabular w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm"
                            />
                            {scaleSupported() && (
                              <button type="button" aria-label={t("pos.readWeightAria", { name: item.product.name })} disabled={scaleBusy === item.product.id} onClick={() => weigh(item.product.id)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted">
                                <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={t("pos.decreaseAria", { name: item.product.name })}
                              onClick={() => updateQuantity(item.product.id, -1)}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <span className="tabular w-6 text-center">{item.quantity}</span>
                            <button
                              type="button"
                              aria-label={t("pos.increaseAria", { name: item.product.name })}
                              onClick={() => updateQuantity(item.product.id, 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-foreground/70">
                        {money(effectivePrice(item.product))}
                        {item.product.discountType && item.product.discountValue > 0 && (
                          <div className="text-xs text-success">
                            -{item.product.discountType === "percent" ? `${item.product.discountValue}%` : money(item.product.discountValue)}
                          </div>
                        )}
                      </td>
                      {shop?.gstEnabled && (
                        <td className="py-2.5 pr-4 text-right text-foreground/50">{item.product.taxRate}%</td>
                      )}
                      <td className="py-2.5 pr-4 text-right font-medium text-foreground">
                        {money(effectivePrice(item.product) * item.quantity)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          aria-label={t("pos.removeAria", { name: item.product.name })}
                          onClick={() => setCart((p) => p.filter((i) => i.product.id !== item.product.id))}
                          className="text-foreground/40 hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Checkout panel */}
        <div className="flex flex-col gap-4">
          {/* Customer */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-foreground">{t("pos.customer")}</h2>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={t("pos.phone")}
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    setCustomer(null);
                    setPointsRedeemed(0);
                  }}
                  placeholder={t("pos.phonePlaceholder")}
                />
              </div>
              <Button type="button" variant="secondary" onClick={() => lookupCustomer()} aria-label={t("pos.findCustomer")}>
                <Search className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <Field
              label={t("pos.nameOptional")}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t("pos.walkIn")}
            />
            {shop?.gstEnabled && (
              <Field label={t("pos.customerGstin")} value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" />
            )}
          </Card>

          {/* Returns / exchange */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-foreground">{t("pos.returnExchange")}</h2>
            <ReturnPanel
              sym={sym}
              drafted={returnLines}
              onAdd={(lines) => setReturnLines((prev) => [...prev, ...lines])}
              onInvoiceFound={onReturnInvoiceFound}
            />
            {returnLines.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                {returnLines.map((l) => (
                  <div key={`${l.invoiceId}:${l.invoiceItemId}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex-1 truncate text-foreground/80">
                      {l.quantity}× {l.name}
                      <span className="ml-1 text-xs text-foreground/40">({l.invoiceNumber})</span>
                    </span>
                    <span className="text-foreground">- {money(l.refundAmount)}</span>
                    <button
                      type="button"
                      aria-label={t("pos.removeReturnAria", { name: l.name })}
                      onClick={() => setReturnLines((prev) => prev.filter((x) => !(x.invoiceId === l.invoiceId && x.invoiceItemId === l.invoiceItemId)))}
                      className="text-foreground/40 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 text-sm font-medium">
                  <span className="text-foreground/60">{t("pos.returnTotal")}</span>
                  <span className="text-foreground">- {money(returnTotal)}</span>
                </div>
              </div>
            )}
            {refundValue > 0 && (
              <div className="rounded-lg bg-warning/10 p-3">
                <p className="text-sm font-medium text-warning">{t("pos.refundDue", { amount: money(refundValue) })}</p>
                <p className="mb-2 mt-0.5 text-xs text-foreground/60">{t("pos.refundMore")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRefundMode("CASH")}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      refundMode === "CASH" ? "border-brand bg-brand text-brand-foreground" : "border-border text-foreground/70 hover:bg-surface-muted"
                    }`}
                  >
                    {t("pos.cashRefund")}
                  </button>
                  <button
                    type="button"
                    disabled={!customer}
                    onClick={() => setRefundMode("CREDIT")}
                    title={!customer ? t("pos.addCustomerToCredit") : undefined}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                      refundMode === "CREDIT" ? "border-brand bg-brand text-brand-foreground" : "border-border text-foreground/70 hover:bg-surface-muted"
                    }`}
                  >
                    {t("pos.storeCreditBtn")}
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* Discount + payment */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-foreground">{t("pos.discount")}</h2>
            <div className="flex gap-2">
              <select
                aria-label={t("pos.discountTypeAria")}
                value={discountType ?? ""}
                onChange={(e) => setDiscountType((e.target.value || null) as "percent" | "amount" | null)}
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground"
              >
                <option value="">{t("pos.none")}</option>
                <option value="percent">%</option>
                <option value="amount">{sym}</option>
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={!discountType}
                value={discountValue || ""}
                onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                placeholder={t("pos.discountValuePlaceholder")}
                aria-label={t("pos.discountValueAria")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground disabled:opacity-50"
              />
            </div>

            <h2 className="mt-2 text-base font-semibold text-foreground">{t("pos.payment")}</h2>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "UPI", "CARD"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(m);
                    if (m !== "CARD") setTerminalPaymentId(null);
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    paymentMethod === m
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border text-foreground/70 hover:bg-surface-muted"
                  }`}
                >
                  {(() => {
                    const key = paymentMethodKey(m);
                    return key ? t(key) : m;
                  })()}
                </button>
              ))}
            </div>
            {paymentMethod === "UPI" && shop?.upiId && collectTotal > 0 && <UpiQr amount={collectTotal} onUri={setUpiUri} />}
            {paymentMethod === "CARD" && shop?.terminalProvider && shop.terminalProvider !== "none" && collectTotal > 0 && (
              <TerminalCharge amount={collectTotal} reference="POS" paymentId={terminalPaymentId} onPaid={setTerminalPaymentId} />
            )}
            {paymentMethod === "CASH" && fxCodes.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <Smartphone className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
                <span className="text-foreground-muted">{t("pos.customerPaysIn")}</span>
                <select aria-label={t("pos.paymentCurrencyAria")} value={payCurrency} onChange={(e) => { setPayCurrency(e.target.value); setAmountPaid(""); }} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
                  <option value="">{fx?.base}</option>
                  {fxCodes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
            {paymentMethod === "CASH" && payCurrency && fxRate > 0 && (
              <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">
                1 {payCurrency} = {formatMoney(fxRate, sym)} · {formatMoney(collectTotal, sym)} = <b className="tabular">{round2(collectTotal / fxRate).toFixed(2)} {payCurrency}</b>
              </p>
            )}
            {paymentMethod === "CASH" && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label={payCurrency && fxRate ? t("pos.amountReceivedCurrency", { currency: payCurrency }) : t("pos.amountReceived")}
                    type="number"
                    min={0}
                    step="0.01"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="whitespace-nowrap"
                  onClick={() => setAmountPaid(String(payCurrency && fxRate ? round2(collectTotal / fxRate) : collectTotal))}
                  disabled={collectTotal === 0}
                >
                  {t("pos.paidInFull")}
                </Button>
              </div>
            )}
          </Card>

          {/* Totals */}
          <Card className="flex flex-col gap-2 p-5">
            {(() => {
              const adjusted = returnTotal > 0 || creditUse > 0 || dueToClear > 0;
              return (
                <>
                  <Row label={adjusted ? t("pos.thisSale") : t("pos.subtotal")} value={money(adjusted ? quote.total : quote.subtotal)} />
                  {!adjusted && quote.discountAmount > 0 && <Row label={t("pos.discount")} value={`- ${money(quote.discountAmount)}`} />}
                  {!adjusted && shop?.gstEnabled && quote.taxAmount > 0 && <Row label={t("pos.gstIncluded")} value={money(quote.taxAmount)} />}
                  {!adjusted && quote.loyaltyDiscount > 0 && <Row label={t("pos.loyalty")} value={`- ${money(quote.loyaltyDiscount)}`} />}
                  {returnTotal > 0 && <Row label={t("pos.returns")} value={`- ${money(returnTotal)}`} />}
                  {creditUse > 0 && <Row label={t("pos.storeCreditUsed")} value={`- ${money(creditUse)}`} />}
                  {/* Show what will ACTUALLY clear given the tender so far
                      (duePaidFinal), not the intended amount (dueToClear) —
                      on a cash bill that's still short, the due hasn't been
                      funded yet, and claiming it's cleared here is exactly
                      what made cashiers think a due had been paid when the
                      backend correctly left it standing. */}
                  {dueToClear > 0 && (
                    <Row
                      label={duePaidFinal < dueToClear ? t("pos.dueNeedsFull") : t("pos.previousDueCleared")}
                      value={money(duePaidFinal)}
                    />
                  )}
                </>
              );
            })()}
            <div className="my-1 border-t border-border" />
            {refundValue > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-warning">{t("pos.refundLabel", { mode: refundMode === "CREDIT" ? t("pos.storeCredit") : t("pos.cash") })}</span>
                <span className="text-xl font-semibold text-warning">{money(refundValue)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground/70">
                  {returnTotal > 0 || creditUse > 0 || dueToClear > 0 ? t("pos.toCollect") : t("pos.grandTotal")}
                </span>
                <span className="text-xl font-semibold text-foreground">{money(collectTotal)}</span>
              </div>
            )}
            {paymentMethod === "CASH" && Number(amountPaid) > 0 && changeDue > 0 && (
              <Row label={t("pos.change")} value={money(changeDue)} />
            )}
            {shortNow > 0 && (
              <p className={`rounded-lg px-3 py-2 text-xs font-medium ${customer ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger"}`}>
                {customer
                  ? t("pos.shortWithCustomer", { amount: money(shortNow), name: customer.name })
                  : t("pos.shortNoCustomer", { amount: money(shortNow) })}
              </p>
            )}
            {shop?.loyaltyEnabled && customer && quote.pointsEarned > 0 && (
              <p className="text-xs text-foreground/50">{t("pos.earnsPoints", { count: quote.pointsEarned })}</p>
            )}
            <Button
              onClick={finalizeSale}
              disabled={!canFinalize || isCheckingOut}
              className="mt-2 w-full"
            >
              {isCheckingOut
                ? t("pos.processing")
                : refundValue > 0 && cart.length === 0
                  ? t("pos.processReturn")
                  : cart.length === 0 && returnLines.length === 0 && dueToClear > 0
                    ? t("pos.collectDue")
                    : t("pos.finalizeSale")}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground/60">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
