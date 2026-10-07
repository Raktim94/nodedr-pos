"use client";

import { useRef } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { compressImage } from "@/lib/productImage";

// Photo picker for the product form. `src` is whatever should be previewed
// (existing photo, online suggestion, or a freshly chosen file). Choosing a
// file reports a compressed data URL; remove reports null.
export function ProductImageField({ src, onChange }: { src: string | null; onChange: (dataUrl: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      onChange(await compressImage(file));
    } catch (err) {
      show(err instanceof Error ? err.message : "Could not use that image", "error");
    }
  }

  return (
    <section aria-label="Product photo" className="flex items-center gap-4">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-muted">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Product" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-7 w-7 text-foreground/30" aria-hidden="true" />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            {src ? "Change photo" : "Add photo"}
          </Button>
          {src && (
            <Button type="button" variant="ghost" onClick={() => onChange(null)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-foreground-muted">Pick a file or take a photo on a phone. Resized automatically.</p>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Product photo file" onChange={onFile} />
      </div>
    </section>
  );
}
