"use client";

import { useCallback, useState } from "react";
import { Plus, ScanBarcode, Search, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProductModal } from "@/components/ProductModal";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useDeleteProduct, useProducts } from "@/hooks/useProducts";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";

type ModalState = { mode: "add"; initialBarcode?: string } | { mode: "edit"; product: Product } | null;

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const { data: shop } = useShopSettings();
  const { data: products, isLoading } = useProducts(search);
  const deleteProduct = useDeleteProduct();
  const { show } = useToast();

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);
  const lowStockThreshold = shop?.lowStockAlert ?? 5;

  const handleScan = useCallback(
    async (code: string) => {
      try {
        const product = await api.get<Product>(`/products/barcode/${encodeURIComponent(code)}`);
        setModal({ mode: "edit", product });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setModal({ mode: "add", initialBarcode: code });
        else show("Barcode lookup failed", "error");
      }
    },
    [show]
  );

  useBarcodeScanner({ onScan: handleScan, enabled: modal === null });

  async function handleDelete(product: Product) {
    if (!window.confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    try {
      await deleteProduct.mutateAsync(product.id);
      show("Product deleted", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not delete product", "error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Inventory</h1>
          <p className="flex items-center gap-1.5 text-sm text-foreground/60">
            <ScanBarcode className="h-4 w-4" aria-hidden="true" />
            Scan a barcode to edit stock, or add a new product.
          </p>
        </div>
        <Button onClick={() => setModal({ mode: "add" })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add product
        </Button>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, barcode or category…"
            aria-label="Search products"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-foreground/50">Loading products…</p>
        ) : !products || products.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground/50">
            No products yet. Scan a barcode or click &quot;Add product&quot; to start.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-foreground/50">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Barcode</th>
                  <th className="py-2 pr-4">Category</th>
                  {shop?.gstEnabled && <th className="py-2 pr-4 text-right">GST</th>}
                  <th className="py-2 pr-4 text-right">Cost</th>
                  <th className="py-2 pr-4 text-right">Price</th>
                  <th className="py-2 pr-4 text-right">Stock</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((product) => {
                  const low = product.stock <= lowStockThreshold;
                  return (
                    <tr key={product.id}>
                      <td className="py-2.5 pr-4">
                        <button
                          type="button"
                          onClick={() => setModal({ mode: "edit", product })}
                          className="font-medium text-foreground hover:text-brand hover:underline"
                        >
                          {product.name}
                        </button>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-foreground/60">{product.barcode}</td>
                      <td className="py-2.5 pr-4 text-foreground/60">{product.category || "—"}</td>
                      {shop?.gstEnabled && (
                        <td className="py-2.5 pr-4 text-right text-foreground/60">{product.taxRate}%</td>
                      )}
                      <td className="py-2.5 pr-4 text-right text-foreground/70">{money(product.purchasePrice)}</td>
                      <td className="py-2.5 pr-4 text-right text-foreground/70">{money(product.sellingPrice)}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span
                          className={
                            low
                              ? "rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning"
                              : "text-foreground/70"
                          }
                        >
                          {product.stock}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          aria-label={`Delete ${product.name}`}
                          onClick={() => handleDelete(product)}
                          className="text-foreground/40 hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal?.mode === "add" && (
        <ProductModal mode="add" initialBarcode={modal.initialBarcode} onClose={() => setModal(null)} />
      )}
      {modal?.mode === "edit" && <ProductModal mode="edit" product={modal.product} onClose={() => setModal(null)} />}
    </div>
  );
}
