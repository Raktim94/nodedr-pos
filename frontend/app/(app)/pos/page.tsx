"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ScanBarcode, Trash2, Search, Star, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ReceiptActions } from "@/components/ReceiptActions";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { openReceiptPrint } from "@/lib/print";
import { effectivePrice, quoteSale } from "@/lib/quote";
import type { CartItem, Customer, Invoice, PaymentMethod, Product } from "@/lib/types";

export default function PosPage() {
  const { data: shop } = useShopSettings();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount" | null>(null);
  const [discountValue, setDiscountValue] = useState(0);
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [amountPaid, setAmountPaid] = useState("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [completedSale, setCompletedSale] = useState<{ id: number; invoiceNumber: string; totalAmount: number } | null>(
    null
  );

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);

  const quote = useMemo(
    () => quoteSale({ cart, discountType, discountValue, pointsRedeemed, settings: shop }),
    [cart, discountType, discountValue, pointsRedeemed, shop]
  );

  const changeDue = paymentMethod === "CASH" ? Math.max(0, (Number(amountPaid) || 0) - quote.total) : 0;
  const dueNow =
    paymentMethod === "CASH" && Number(amountPaid) > 0 ? Math.max(0, quote.total - (Number(amountPaid) || 0)) : 0;

  const addToCart = useCallback(
    (product: Product) => {
      setCompletedSale(null);
      setCart((prev) => {
        const existing = prev.find((item) => item.product.id === product.id);
        if (!existing) return [...prev, { product, quantity: 1 }];
        if (existing.quantity >= product.stock) {
          show(`Only ${product.stock} in stock for "${product.name}"`, "error");
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      });
    },
    [show]
  );

  const handleScan = useCallback(
    async (code: string) => {
      try {
        const product = await api.get<Product>(`/products/barcode/${encodeURIComponent(code)}`);
        addToCart(product);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) show("Product not found. Please add to inventory.", "error");
        else show("Barcode lookup failed", "error");
      }
    },
    [addToCart, show]
  );

  async function lookupCustomer() {
    if (!customerPhone.trim()) return;
    try {
      const c = await api.get<Customer>(`/customers/phone/${encodeURIComponent(customerPhone.trim())}`);
      setCustomer(c);
      setCustomerName(c.name);
      show(`${c.name} — ${c.loyaltyPoints} points`, "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setCustomer(null);
        show("New customer — will be created on checkout", "info");
      } else {
        show("Customer lookup failed", "error");
      }
    }
  }

  const resetSale = () => {
    setCart([]);
    setCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setDiscountType(null);
    setDiscountValue(0);
    setPointsRedeemed(0);
    setPaymentMethod("CASH");
    setAmountPaid("");
  };

  const finalizeSale = useCallback(async () => {
    if (cart.length === 0 || isCheckingOut) return;
    setIsCheckingOut(true);
    try {
      const invoice = await api.post<Invoice>("/invoices", {
        customerName,
        customerPhone,
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        discountType,
        discountValue: Number(discountValue) || 0,
        pointsRedeemed: Number(pointsRedeemed) || 0,
        paymentMethod,
        amountPaid: paymentMethod === "CASH" ? Number(amountPaid) || 0 : 0,
      });

      show(`Sale complete — ${invoice.invoiceNumber} · ${money(invoice.totalAmount)}`, "success");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setCompletedSale({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount });
      resetSale();
      if (shop?.autoPrintReceipt) openReceiptPrint(invoice.id);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Checkout failed", "error");
    } finally {
      setIsCheckingOut(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, customerName, customerPhone, discountType, discountValue, pointsRedeemed, paymentMethod, amountPaid, isCheckingOut, queryClient, show, shop?.autoPrintReceipt]);

  useBarcodeScanner({
    onScan: handleScan,
    onManualEnter: (event) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (editable) return;
      finalizeSale();
    },
  });

  function updateQuantity(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const nextQty = item.quantity + delta;
          if (nextQty > item.product.stock) {
            show(`Only ${item.product.stock} in stock for "${item.product.name}"`, "error");
            return item;
          }
          return { ...item, quantity: nextQty };
        })
        .filter((item) => item.quantity > 0)
    );
  }

  const maxRedeemable = customer && shop?.loyaltyEnabled ? customer.loyaltyPoints : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">POS Checkout</h1>
        <p className="flex items-center gap-1.5 text-sm text-foreground/60">
          <ScanBarcode className="h-4 w-4" aria-hidden="true" />
          Scan a barcode to add items. Press Enter to finalize.
        </p>
      </div>

      {completedSale && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-brand/30 bg-brand/5 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-brand" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {completedSale.invoiceNumber} · {money(completedSale.totalAmount)}
              </p>
              <p className="text-xs text-foreground/60">
                {shop?.autoPrintReceipt ? "Sale complete — receipt sent to print." : "Sale complete — print or download the receipt below."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ReceiptActions invoiceId={completedSale.id} />
            <Button type="button" variant="ghost" onClick={() => setCompletedSale(null)}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Cart */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-foreground">Cart</h2>
          {cart.length === 0 ? (
            <p className="py-10 text-center text-sm text-foreground/50">Cart is empty. Scan a product to begin.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase text-foreground/50">
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 pr-4 text-right">Price</th>
                    {shop?.gstEnabled && <th className="py-2 pr-4 text-right">GST</th>}
                    <th className="py-2 pr-4 text-right">Total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cart.map((item) => (
                    <tr key={item.product.id}>
                      <td className="py-2.5 pr-4 font-medium text-foreground">
                        {item.product.name}
                        {item.product.unit && <span className="ml-1.5 font-normal text-foreground/40">({item.product.unit})</span>}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Decrease ${item.product.name}`}
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <span className="w-6 text-center">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Increase ${item.product.name}`}
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
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
                          aria-label={`Remove ${item.product.name}`}
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
            <h2 className="text-base font-semibold text-foreground">Customer</h2>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label="Phone"
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    setCustomer(null);
                    setPointsRedeemed(0);
                  }}
                  placeholder="For loyalty"
                />
              </div>
              <Button type="button" variant="secondary" onClick={lookupCustomer} aria-label="Find customer">
                <Search className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <Field
              label="Name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Walk-in Customer"
            />
            {customer && customer.totalDue > 0 && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                Owes {money(customer.totalDue)} from before
              </p>
            )}
            {customer && shop?.loyaltyEnabled && (
              <div className="rounded-lg bg-brand/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Star className="h-4 w-4 text-warning" aria-hidden="true" />
                  {customer.loyaltyPoints} points available
                </p>
                {maxRedeemable > 0 ? (
                  <>
                    <div className="mt-2 flex items-end gap-2">
                      <div className="flex-1">
                        <Field
                          label={`Redeem points (1 pt = ${money(shop.pointValue).replace(sym + " ", sym)})`}
                          type="number"
                          min={0}
                          max={maxRedeemable}
                          value={pointsRedeemed || ""}
                          onChange={(e) => setPointsRedeemed(Math.min(Number(e.target.value) || 0, maxRedeemable))}
                        />
                      </div>
                      <Button type="button" variant="secondary" onClick={() => setPointsRedeemed(maxRedeemable)}>
                        Use all
                      </Button>
                    </div>
                    {pointsRedeemed > 0 && (
                      <p className="mt-1.5 text-xs text-success">
                        {pointsRedeemed} pts = {money(pointsRedeemed * shop.pointValue)} off this sale
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-foreground/50">Not enough points to redeem yet.</p>
                )}
              </div>
            )}
          </Card>

          {/* Discount + payment */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-foreground">Discount</h2>
            <div className="flex gap-2">
              <select
                aria-label="Discount type"
                value={discountType ?? ""}
                onChange={(e) => setDiscountType((e.target.value || null) as "percent" | "amount" | null)}
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground"
              >
                <option value="">None</option>
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
                placeholder="Discount value"
                aria-label="Discount value"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground disabled:opacity-50"
              />
            </div>

            <h2 className="mt-2 text-base font-semibold text-foreground">Payment</h2>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "UPI", "CARD"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    paymentMethod === m
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border text-foreground/70 hover:bg-surface-muted"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {paymentMethod === "CASH" && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label="Amount received"
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
                  onClick={() => setAmountPaid(String(quote.total))}
                  disabled={cart.length === 0}
                >
                  Paid in full
                </Button>
              </div>
            )}
          </Card>

          {/* Totals */}
          <Card className="flex flex-col gap-2 p-5">
            <Row label="Subtotal" value={money(quote.subtotal)} />
            {quote.discountAmount > 0 && <Row label="Discount" value={`- ${money(quote.discountAmount)}`} />}
            {shop?.gstEnabled && quote.taxAmount > 0 && <Row label="GST (included)" value={money(quote.taxAmount)} />}
            {quote.loyaltyDiscount > 0 && <Row label="Loyalty" value={`- ${money(quote.loyaltyDiscount)}`} />}
            <div className="my-1 border-t border-border" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground/70">Grand Total</span>
              <span className="text-xl font-semibold text-foreground">{money(quote.total)}</span>
            </div>
            {paymentMethod === "CASH" && Number(amountPaid) > 0 && (
              <Row label="Change" value={money(changeDue)} />
            )}
            {dueNow > 0 && (
              <p className={`rounded-lg px-3 py-2 text-xs font-medium ${customer ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger"}`}>
                {customer
                  ? `${money(dueNow)} will be added to ${customer.name}'s due balance`
                  : `${money(dueNow)} short — add a customer (phone) to record this as a due, or collect the full amount`}
              </p>
            )}
            {shop?.loyaltyEnabled && customer && quote.pointsEarned > 0 && (
              <p className="text-xs text-foreground/50">Earns {quote.pointsEarned} points</p>
            )}
            <Button onClick={finalizeSale} disabled={cart.length === 0 || isCheckingOut} className="mt-2 w-full">
              {isCheckingOut ? "Processing…" : "Finalize Sale (Enter)"}
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
