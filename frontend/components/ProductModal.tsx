"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useCreateProduct, useUpdateProduct } from "@/hooks/useProducts";
import { useShopSettings } from "@/hooks/useShopSettings";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import type { Product } from "@/lib/types";

const productSchema = z.object({
  barcode: z.string().trim().min(1, "Barcode is required"),
  name: z.string().trim().min(1, "Product name is required"),
  category: z.string().trim().optional(),
  hsn: z.string().trim().optional(),
  purchasePrice: z.number().min(0, "Must be 0 or more"),
  sellingPrice: z.number().min(0, "Must be 0 or more"),
  taxRate: z.number().min(0).max(100),
  stock: z.number().int().min(0, "Must be 0 or more"),
});
type ProductForm = z.infer<typeof productSchema>;

interface ProductModalProps {
  mode: "add" | "edit";
  product?: Product;
  initialBarcode?: string;
  onClose: () => void;
}

export function ProductModal({ mode, product, initialBarcode, onClose }: ProductModalProps) {
  const { show } = useToast();
  const { data: shop } = useShopSettings();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductForm>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      barcode: product?.barcode ?? initialBarcode ?? "",
      name: product?.name ?? "",
      category: product?.category ?? "",
      hsn: product?.hsn ?? "",
      purchasePrice: product?.purchasePrice ?? 0,
      sellingPrice: product?.sellingPrice ?? 0,
      taxRate: product?.taxRate ?? shop?.defaultTaxRate ?? 0,
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
          <Field label="Barcode" autoFocus={mode === "add"} error={errors.barcode?.message} {...register("barcode")} />
          <Field label="Product name" error={errors.name?.message} {...register("name")} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category" {...register("category")} />
            {gst && <Field label="HSN / SAC" {...register("hsn")} />}
          </div>
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
