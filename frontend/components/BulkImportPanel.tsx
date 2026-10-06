"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Bits";
import { api, ApiError } from "@/lib/api";

// Bulk product import (CSV / Excel). Same flow as Rechvix's importer:
//   pick a file → Preview (dry run, writes nothing, every row's outcome is
//   listed) → Import (commits the valid rows in one all-or-nothing step).
// Nothing is silently skipped: errors and duplicates are reported per row.
interface RowResult { row: number; name: string; outcome: "COMMITTED" | "VALID" | "ERROR" | "DUPLICATE"; message: string }
interface Report { dryRun: boolean; total: number; committed: number; valid: number; errors: number; duplicates: number; results: RowResult[] }

const COLUMNS = "name*, selling_price*, barcode, sku, category, hsn, unit, purchase_price, tax_rate, stock, reorder_point, discount_type, discount_value, track_serial, warranty_months, serials, supplier";

export function BulkImportPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState("");

  async function run(dryRun: boolean) {
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "xlsx") return setError("Please choose a .csv or .xlsx file.");
    setError("");
    setBusy(dryRun ? "preview" : "import");
    try {
      const r = await api.uploadRaw<Report>(`/products/import?format=${ext}${dryRun ? "&dry_run=1" : ""}`, file);
      setReport(r);
      if (!dryRun) qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not process this file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card-surface rise p-5" aria-label="Bulk import">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Import products from CSV / Excel</h2>
        <Button variant="ghost" onClick={onClose}>Hide</Button>
      </div>
      <p className="mb-3 text-sm text-foreground-muted">
        First row is the header. Columns: <code className="break-words text-xs">{COLUMNS}</code>. Leave <code>barcode</code> blank to auto-generate one; for phones etc. set <code>track_serial</code> to yes and list IMEIs in <code>serials</code> (separated by ; ).{" "}
        <a href="/api/products/import/sample.csv" download className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline"><Download className="h-3.5 w-3.5" aria-hidden="true" />Download a sample CSV</a>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,.xlsx" aria-label="Products file" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(""); }} />
        <Button variant="secondary" disabled={!file || busy !== null} onClick={() => run(true)}>{busy === "preview" ? "Checking…" : "Preview"}</Button>
        {report?.dryRun && report.valid > 0 && (
          <Button disabled={busy !== null} onClick={() => run(false)}><FileUp className="h-4 w-4" aria-hidden="true" />{busy === "import" ? "Importing…" : `Import ${report.valid} product${report.valid === 1 ? "" : "s"}`}</Button>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {report && (
        <div className="mt-4">
          <p className="text-sm" role="status">
            {report.dryRun ? "Preview: " : "Imported: "}<b>{report.committed}</b> added, <b>{report.valid}</b> ready, <b>{report.duplicates}</b> duplicate (skipped), <b>{report.errors}</b> error{report.errors === 1 ? "" : "s"} — {report.total} row(s).
          </p>
          {report.results.some((r) => r.outcome !== "VALID" || r.message) && (
            <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="sticky top-0 bg-surface-muted text-xs text-foreground-muted"><tr><th className="p-2">Row</th><th className="p-2">Product</th><th className="p-2">Outcome</th><th className="p-2">Message</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {report.results.filter((r) => r.outcome !== "VALID" || r.message).map((r) => (
                    <tr key={r.row}>
                      <td className="tabular p-2">{r.row}</td>
                      <td className="max-w-[180px] truncate p-2">{r.name || "—"}</td>
                      <td className="p-2"><Badge tone={r.outcome === "ERROR" ? "bad" : r.outcome === "DUPLICATE" ? "warn" : "good"}>{r.outcome}</Badge></td>
                      <td className="p-2 text-foreground-muted">{r.message || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
