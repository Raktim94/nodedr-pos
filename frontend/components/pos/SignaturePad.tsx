"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

// Draw with a finger/stylus/mouse, or upload an image of a signature.
// Returns a PNG data URL (the backend validates the bytes and re-hashes it).
export function SignaturePad({ title, onSave, onClose }: { title: string; onSave: (dataUrl: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [upload, setUpload] = useState<string | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0d3b28";
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setDirty(true);
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
    setUpload(null);
  }
  function onFile(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type) || f.size > 300 * 1024) {
      alert("Choose a PNG or JPEG under 300 KB");
      return;
    }
    const r = new FileReader();
    r.onload = () => setUpload(String(r.result));
    r.readAsDataURL(f);
  }
  function save() {
    if (upload) return onSave(upload);
    const c = canvasRef.current!;
    // Downscale to ≤ 600px wide so the stored file stays small (<~40 KB).
    const scale = Math.min(1, 600 / c.width);
    const out = document.createElement("canvas");
    out.width = Math.round(c.width * scale);
    out.height = Math.round(c.height * scale);
    out.getContext("2d")!.drawImage(c, 0, 0, out.width, out.height);
    onSave(out.toDataURL("image/png"));
  }

  return (
    <Modal title={title} onClose={onClose} size="md">
      <div className="flex flex-col gap-3">
        {upload ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={upload} alt="Signature preview" className="h-40 w-full rounded-xl border border-border bg-white object-contain" />
        ) : (
          <canvas
            ref={canvasRef}
            aria-label="Signature drawing area"
            className="h-40 w-full touch-none rounded-xl border border-dashed border-border bg-white"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (drawing.current = false)}
            onPointerLeave={() => (drawing.current = false)}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={clear}>
              <Eraser className="h-4 w-4" aria-hidden="true" /> Clear
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted px-4 py-2.5 text-sm font-semibold hover:bg-border">
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload image
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <Button onClick={save} disabled={!dirty && !upload}>
            Save signature
          </Button>
        </div>
      </div>
    </Modal>
  );
}
