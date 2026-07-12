// Generates internal EAN-13 barcodes for products that don't come with one
// printed by the manufacturer. Uses the "20"-"29" prefix range, which GS1
// reserves for restricted/internal circulation — i.e. exactly this use case
// (in-store labels, not resellable retail codes) — so the result is a
// structurally valid EAN-13 any barcode scanner can read, without claiming
// to be a real globally-assigned product code.

function ean13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(digits12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateEan13(existingBarcodes: Iterable<string> = []): string {
  const existing = existingBarcodes instanceof Set ? existingBarcodes : new Set(existingBarcodes);
  for (let attempt = 0; attempt < 50; attempt++) {
    const rand = Math.floor(Math.random() * 1e10)
      .toString()
      .padStart(10, "0");
    const digits12 = `20${rand}`;
    const code = `${digits12}${ean13CheckDigit(digits12)}`;
    if (!existing.has(code)) return code;
  }
  throw new Error("Could not generate a unique barcode — please try again");
}
