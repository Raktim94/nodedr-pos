"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Barcode as BarcodeIcon, X } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { BarcodeDownloadPanel } from "@/components/BarcodeDownloadPanel";
import { useCreateProduct, useProducts, useUpdateProduct } from "@/hooks/useProducts";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/lib/api";
import { generateEan13 } from "@/lib/barcode";
import { formatMoney } from "@/lib/format";
import { GENERIC_PRODUCT_CATEGORIES, GST_RATES, UQC_UNITS } from "@/lib/masters";
import type { Product } from "@/lib/types";

const productSchema = z.object({
  barcode: z.string().trim().min(1, "Barcode is required"),
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().optional(),
  hsn: z.string().trim().optional(),
  unit: z.string().trim().optional(),
  purchasePrice: z.number().min(0, "Must be 0 or more"),
  sellingPrice: z.number().min(0, "Must be 0 or more"),
  taxRate: z.number().min(0).max(100),
  discountType: z.enum(["percent", "amount"]).nullable(),
  discountValue: z.number().min(0, "Must be 0 or more"),
  stock: z.number().int().min(0, "Must be 0 or more"),
});
type ProductForm = z.infer<typeof productSchema>;

const UNIT_OPTIONS = [{ value: "", label: "No unit" }, ...UQC_UNITS.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }))];

interface TaxCodeSuggestion {
  code: string;
  description: string;
}

interface ProductModalProps {
  mode: "add" | "edit";
  product?: Product;
  initialBarcode?: string;
  onClose: () => void;
}

export function ProductModal({ mode, product, initialBarcode, onClose }: ProductModalProps) {
  const { show } = useToast();
  const { data: shop } = useShopSettings();
  const { data: products } = useProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ProductForm>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      barcode: product?.barcode ?? initialBarcode ?? "",
      name: product?.name ?? "",
      category: product?.category ?? "",
      hsn: product?.hsn ?? "",
      unit: product?.unit ?? "",
      purchasePrice: product?.purchasePrice ?? 0,
      sellingPrice: product?.sellingPrice ?? 0,
      taxRate: product?.taxRate ?? shop?.defaultTaxRate ?? 0,
      discountType: product?.discountType ?? null,
      discountValue: product?.discountValue ?? 0,
      stock: product?.stock ?? 0,
    },
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function onSubmit(values: ProductForm) {
    try {
      if (mode === "edit" && product) {
        await updateProduct.mutateAsync({ id: product.id, data: values });
        show("Product updated", "success");
      } else {
        await createProduct.mutateAsync(values);
        show("Product added", "success");
      }
      onClose();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not save product", "error");
    }
  }

  const gst = shop?.gstEnabled;
  const taxRate = useWatch({ control, name: "taxRate" });
  const hsnValue = useWatch({ control, name: "hsn" });
  const barcodeValue = useWatch({ control, name: "barcode" });
  const sellingPrice = useWatch({ control, name: "sellingPrice" });
  const discountType = useWatch({ control, name: "discountType" });
  const discountValue = useWatch({ control, name: "discountValue" });
  const sym = shop?.currencySymbol ?? "Rs.";
  const discountedPrice = (() => {
    if (!discountType || !discountValue) return sellingPrice;
    if (discountType === "percent") {
      const pct = Math.min(100, Math.max(0, discountValue));
      return Math.round(sellingPrice * (1 - pct / 100) * 100) / 100;
    }
    const amt = Math.min(sellingPrice, Math.max(0, discountValue));
    return Math.round((sellingPrice - amt) * 100) / 100;
  })();

  function generateBarcode() {
    const code = generateEan13(products?.map((p) => p.barcode) ?? []);
    setValue("barcode", code, { shouldValidate: true, shouldDirty: true });
  }

  const categoryOptions = useMemo(() => {
    const existing = new Set((products ?? []).map((p) => p.category).filter((c): c is string => !!c));
    return Array.from(new Set([...existing, ...GENERIC_PRODUCT_CATEGORIES])).sort();
  }, [products]);

  const [showBarcodeImage, setShowBarcodeImage] = useState(false);
  const [hsnSuggestions, setHsnSuggestions] = useState<TaxCodeSuggestion[]>([]);
  useEffect(() => {
    const query = hsnValue?.trim() ?? "";
    const handle = setTimeout(() => {
      if (!gst || query.length < 2) {
        setHsnSuggestions([]);
        return;
      }
      api
        .get<TaxCodeSuggestion[]>(`/masters/tax-codes/search?q=${encodeURIComponent(query)}`)
        .then(setHsnSuggestions)
        .catch(() => setHsnSuggestions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [gst, hsnValue]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-surface p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="product-modal-title" className="text-lg font-semibold text-foreground">
            {mode === "edit" ? "Edit Product" : "Add New Product"}
          </h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-foreground/40 hover:text-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Barcode" autoFocus={mode === "add"} error={errors.barcode?.message} {...register("barcode")} />
            </div>
            <Button type="button" variant="secondary" onClick={generateBarcode} title="Generate a barcode for a product that doesn't have one">
              <BarcodeIcon className="h-4 w-4" aria-hidden="true" />
              Generate
            </Button>
          </div>
          {barcodeValue?.trim() && (
            <div>
              <button
                type="button"
                onClick={() => setShowBarcodeImage((v) => !v)}
                className="text-sm font-medium text-brand hover:underline"
              >
                {showBarcodeImage ? "Hide barcode image" : "Get barcode image to print (PNG/JPG)"}
              </button>
              {showBarcodeImage && (
                <div className="mt-3">
                  <BarcodeDownloadPanel value={barcodeValue.trim()} />
                </div>
              )}
            </div>
          )}
          <Field label="Product name" error={errors.name?.message} {...register("name")} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category" list="category-options" {...register("category")} />
            <Select label="Unit" options={UNIT_OPTIONS} {...register("unit")} />
          </div>
          {gst && <Field label="HSN / SAC" list="hsn-options" {...register("hsn")} />}
          <datalist id="category-options">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="hsn-options">
            {hsnSuggestions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.description}
              </option>
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Purchase price"
              type="number"
              step="0.01"
              min={0}
              error={errors.purchasePrice?.message}
              {...register("purchasePrice", { valueAsNumber: true })}
            />
            <Field
              label="Selling price"
              type="number"
              step="0.01"
              min={0}
              error={errors.sellingPrice?.message}
              {...register("sellingPrice", { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Standing discount (applied automatically at checkout)
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Discount type"
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground"
                {...register("discountType", { setValueAs: (v) => (v === "" ? null : v) })}
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
                placeholder="Discount value"
                aria-label="Discount value"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground disabled:opacity-50"
                {...register("discountValue", { valueAsNumber: true })}
              />
            </div>
            {errors.discountValue?.message && <p className="mt-1 text-sm text-danger">{errors.discountValue.message}</p>}
            {discountType && discountValue > 0 && (
              <p className="mt-1 text-xs text-success">Sells at {formatMoney(discountedPrice, sym)}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Stock quantity"
              type="number"
              min={0}
              autoFocus={mode === "edit"}
              error={errors.stock?.message}
              {...register("stock", { valueAsNumber: true })}
            />
            {gst && (
              <Field
                label="GST rate %"
                type="number"
                min={0}
                step="0.01"
                error={errors.taxRate?.message}
                {...register("taxRate", { valueAsNumber: true })}
              />
            )}
          </div>
          {gst && (
            <div className="-mt-2 flex flex-wrap gap-1.5">
              {GST_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setValue("taxRate", rate, { shouldValidate: true, shouldDirty: true })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    taxRate === rate
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border text-foreground/60 hover:bg-surface-muted"
                  }`}
                >
                  {rate}%
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {mode === "edit" ? "Save changes" : "Add product"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
