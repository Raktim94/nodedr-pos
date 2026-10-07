// Shrinks a photo in the browser before upload: longest side 800px, JPEG.
// Phone photos are several MB; the server caps images at 800 KB.
export async function compressImage(file: File, maxSide = 800, quality = 0.82): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image could not be read");
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is not available in this browser");
  ctx.fillStyle = "#fff"; // JPEG has no alpha
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export const productImageSrc = (file: string | null | undefined) => (file ? `/api/products/image/${file}` : null);
