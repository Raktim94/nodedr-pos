"use client";

import { useCallback, useState } from "react";
import { Barcode as BarcodeIcon, FileUp, Globe, ImageIcon, PackagePlus, Pencil, Plus, ScanBarcode, Search, Tag, Trash2 } from "lucide-react";
import { BulkImportPanel } from "@/components/BulkImportPanel";
import { can } from "@/lib/perm";
import { useMe } from "@/hooks/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProductModal } from "@/components/ProductModal";
import { ProductLookupModal } from "@/components/ProductLookupModal";
import { productImageSrc } from "@/lib/productImage";
import { lookupBarcode } from "@/lib/productLookup";
import { StockAdjustModal } from "@/components/StockAdjustModal";
import { BarcodeLabelModal } from "@/components/BarcodeLabelModal";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useDeleteProduct, useProducts } from "@/hooks/useProducts";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { effectivePrice } from "@/lib/quote";
import type { Product, ProductLookupResult } from "@/lib/types";

type ModalState = { mode: "add"; initialBarcode?: string; prefill?: ProductLookupResult } | { mode: "edit"; product: Product } | null;

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [labelTarget, setLabelTarget] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const { data: me } = useMe();
  const canEdit = can(me, "inventory");
  const { data: shop } = useShopSettings();
  const { data: products, isLoading } = useProducts(search);
  const deleteProduct = useDeleteProduct();
  const { show } = useToast();
  const { t } = useTranslation();

  const sym = shop?.currencySymbol || "Rs.";
  const money = (n: number) => formatMoney(n, sym);
  const lowStockThreshold = shop?.lowStockAlert ?? 5;

  const handleScan = useCallback(
    async (code: string) => {
      try {
        const product = await api.get<Product>(`/products/barcode/${encodeURIComponent(code)}`);
        setModal({ mode: "edit", product });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Not in the catalog: try the online databases (first answer wins, so
          // this is quick) and open the form pre-filled for review. Any failure
          // just opens the empty form for this barcode.
          try {
            const found = await lookupBarcode(code);
            if (found) {
              show(t("inventory.detailsFilled", { source: found.source }), "success");
              setModal({ mode: "add", initialBarcode: code, prefill: found });
              return;
            }
          } catch {
            // offline / database down — manual entry below
          }
          setModal({ mode: "add", initialBarcode: code });
        } else show(t("inventory.barcodeFailed"), "error");
      }
    },
    [show, t]
  );

  useBarcodeScanner({ onScan: handleScan, enabled: modal === null && stockTarget === null && !importOpen && !lookupOpen });

  async function handleDelete(product: Product) {
    if (!window.confirm(t("inventory.confirmDelete", { name: product.name }))) return;
    try {
      await deleteProduct.mutateAsync(product.id);
      show(t("inventory.deleted"), "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("inventory.deleteFailed"), "error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("inventory.title")}</h1>
          <p className="flex items-center gap-1.5 text-sm text-foreground/60">
            <ScanBarcode className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("inventory.subtitle")}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setImportOpen((v) => !v)} aria-expanded={importOpen}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              {t("inventory.bulkImport")}
            </Button>
            <Button variant="secondary" onClick={() => setLookupOpen(true)}>
              <Globe className="h-4 w-4" aria-hidden="true" />
              {t("inventory.findOnline")}
            </Button>
            <Button onClick={() => setModal({ mode: "add" })}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("inventory.addProduct")}
            </Button>
          </div>
        )}
      </div>
      {importOpen && canEdit && <BulkImportPanel onClose={() => setImportOpen(false)} />}

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("inventory.searchPlaceholder")}
            aria-label={t("inventory.searchAria")}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-foreground/50">{t("inventory.loading")}</p>
        ) : !products || products.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground/50">{t("inventory.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-foreground/50">
                  <th className="py-2 pr-4">{t("inventory.colProduct")}</th>
                  <th className="py-2 pr-4">{t("inventory.colBarcode")}</th>
                  <th className="py-2 pr-4">{t("inventory.colCategory")}</th>
                  {shop?.gstEnabled && <th className="py-2 pr-4 text-right">{t("inventory.colGst")}</th>}
                  <th className="py-2 pr-4 text-right">{t("inventory.colCost")}</th>
                  <th className="py-2 pr-4 text-right">{t("inventory.colPrice")}</th>
                  <th className="py-2 pr-4 text-right">{t("inventory.colStock")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((product) => {
                  const low = product.stock <= lowStockThreshold;
                  return (
                    <tr key={product.id}>
                      <td className="py-2.5 pr-4">
                        <span className="mr-2.5 inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted align-middle">
                          {product.imageFile ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={productImageSrc(product.imageFile) ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-foreground/25" aria-hidden="true" />
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => setModal({ mode: "edit", product })}
                          className="font-medium text-foreground hover:text-brand hover:underline"
                        >
                          {product.name}
                        </button>
                        {product.unit && <span className="ml-1.5 text-xs text-foreground/40">({product.unit})</span>}
                        {shop?.serialTracking && product.trackSerial && (
                          <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand" title={t("inventory.imeiTitle", { months: product.warrantyMonths })}>
                            IMEI{product.warrantyMonths ? ` · ${product.warrantyMonths}m` : ""}
                          </span>
                        )}
                        {product.sku && (
                          <span
                            className="ml-1.5 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand"
                            title={t("inventory.skuLinked")}
                          >
                            SKU {product.sku}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-foreground/60">{product.barcode}</td>
                      <td className="py-2.5 pr-4 text-foreground/60">{product.category || "—"}</td>
                      {shop?.gstEnabled && (
                        <td className="py-2.5 pr-4 text-right text-foreground/60">{product.taxRate}%</td>
                      )}
                      <td className="py-2.5 pr-4 text-right text-foreground/70">{money(product.purchasePrice)}</td>
                      <td className="py-2.5 pr-4 text-right text-foreground/70">
                        {product.discountType && product.discountValue > 0 ? (
                          <>
                            <span className="text-xs text-foreground/40 line-through">{money(product.sellingPrice)}</span>{" "}
                            <span className="text-success">{money(effectivePrice(product))}</span>
                          </>
                        ) : (
                          money(product.sellingPrice)
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <button
                          type="button"
                          onClick={() => setStockTarget(product)}
                          title={t("inventory.adjustStock")}
                          className={
                            low
                              ? "rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning hover:bg-warning/20"
                              : "rounded-full px-2.5 py-1 text-foreground/70 hover:bg-surface-muted"
                          }
                        >
                          {Math.round(product.stock * 1000) / 1000}
                        </button>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <a href={`/api/print/label/${product.id}?language=zpl&copies=1`} download aria-label={`${t("inventory.zplLabel")} — ${product.name}`} title={t("inventory.zplLabel")} className="text-foreground/40 hover:text-brand">
                            <Tag className="h-4 w-4" aria-hidden="true" />
                          </a>
                          <button
                            type="button"
                            aria-label={`${t("inventory.barcodeLabel")} — ${product.name}`}
                            title={t("inventory.barcodeLabel")}
                            onClick={() => setLabelTarget(product)}
                            className="text-foreground/40 hover:text-brand"
                          >
                            <BarcodeIcon className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`${t("inventory.adjustStock")} — ${product.name}`}
                            title={t("inventory.adjustStock")}
                            onClick={() => setStockTarget(product)}
                            className="text-foreground/40 hover:text-brand"
                          >
                            <PackagePlus className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`${t("inventory.editProduct")} — ${product.name}`}
                            title={t("inventory.editProduct")}
                            onClick={() => setModal({ mode: "edit", product })}
                            className="text-foreground/40 hover:text-brand"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`${t("inventory.deleteProduct")} — ${product.name}`}
                            title={t("inventory.deleteProduct")}
                            onClick={() => handleDelete(product)}
                            className="text-foreground/40 hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
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
        <ProductModal mode="add" initialBarcode={modal.initialBarcode} prefill={modal.prefill} onClose={() => setModal(null)} />
      )}
      {modal?.mode === "edit" && <ProductModal mode="edit" product={modal.product} onClose={() => setModal(null)} />}
      {lookupOpen && (
        <ProductLookupModal
          onClose={() => setLookupOpen(false)}
          onPick={(r) => {
            setLookupOpen(false);
            setModal({ mode: "add", prefill: r });
          }}
        />
      )}
      {stockTarget && <StockAdjustModal product={stockTarget} onClose={() => setStockTarget(null)} />}
      {labelTarget && <BarcodeLabelModal product={labelTarget} onClose={() => setLabelTarget(null)} />}
    </div>
  );
}
