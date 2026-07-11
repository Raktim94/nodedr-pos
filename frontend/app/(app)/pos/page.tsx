"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import type { CartItem, Invoice, Product } from "@/lib/types";

export default function PosPage() {
  const { data: shop } = useShopSettings();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const currency = shop?.currency || "Rs.";
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0), [cart]);

  const addToCart = useCallback(
    (product: Product) => {
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
        if (err instanceof ApiError && err.status === 404) {
          show("Product not found. Please add to inventory.", "error");
        } else {
          show("Barcode lookup failed", "error");
        }
      }
    },
    [addToCart, show]
  );

  const finalizeSale = useCallback(async () => {
    if (cart.length === 0 || isCheckingOut) return;
    setIsCheckingOut(true);
    try {
      const invoice = await api.post<Invoice>("/invoices", {
        customerName,
        customerPhone,
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });

      show(`Sale completed — Invoice #${invoice.invoiceNumber}`, "success");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");

      try {
        const printResult = await api.post<{ printed: boolean; reason?: string }>("/print", {
          invoiceId: invoice.id,
        });
        if (!printResult.printed) {
          show(printResult.reason || "Receipt not printed (no printer detected)", "info");
        }
      } catch {
        show("Sale saved, but sending the receipt to the printer failed", "info");
      }
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Checkout failed", "error");
    } finally {
      setIsCheckingOut(false);
    }
  }, [cart, customerName, customerPhone, isCheckingOut, queryClient, show]);

  useBarcodeScanner({
    onScan: handleScan,
    onManualEnter: (event) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditable) return;
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

  function removeItem(productId: number) {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">POS Checkout</h1>
        <p className="flex items-center gap-1.5 text-sm text-foreground/60">
          <ScanBarcode className="h-4 w-4" aria-hidden="true" />
          Scan a barcode to add items. Press Enter to finalize the sale.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
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
                    <th className="py-2 pr-4 text-right">Total</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cart.map((item) => (
                    <tr key={item.product.id}>
                      <td className="py-2.5 pr-4 font-medium text-foreground">{item.product.name}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Decrease quantity of ${item.product.name}`}
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <span className="w-6 text-center">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Increase quantity of ${item.product.name}`}
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-surface-muted"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-foreground/70">
                        {currency} {item.product.sellingPrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-medium text-foreground">
                        {currency} {(item.product.sellingPrice * item.quantity).toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          aria-label={`Remove ${item.product.name} from cart`}
                          onClick={() => removeItem(item.product.id)}
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

        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold text-foreground">Customer</h2>
          <Field
            label="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Walk-in Customer"
          />
          <Field
            label="Phone number (optional)"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />

          <div className="mt-2 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm font-medium text-foreground/60">Grand Total</span>
            <span className="text-xl font-semibold text-foreground">
              {currency} {total.toFixed(2)}
            </span>
          </div>

          <Button
            onClick={finalizeSale}
            disabled={cart.length === 0 || isCheckingOut}
            className="w-full"
          >
            {isCheckingOut ? "Processing..." : "Finalize Sale (Enter)"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
