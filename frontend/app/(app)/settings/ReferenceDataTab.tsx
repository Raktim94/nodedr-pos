"use client";

import { useState } from "react";
import { Search, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { ApiError, api } from "@/lib/api";
import {
  useImportIfsc,
  useImportPincodes,
  useImportTaxCodes,
  useMastersSummary,
  type IfscRecord,
} from "@/hooks/useMasters";

// Bulk reference data (full HSN/SAC catalogs, PIN codes, IFSC codes) is
// deliberately NOT bundled with the app — these are large, frequently-
// revised government/RBI datasets, and a stale or subtly wrong snapshot
// risks real tax-filing or banking mistakes. Instead: import the current
// official CSV yourself, whenever you have it. See README > Reference
// data & validation.
export function ReferenceDataTab() {
  const { data: summary } = useMastersSummary();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <TaxCodeImportCard count={summary} />
      <PinCodeImportCard count={summary?.pincodes} />
      <IfscCard count={summary?.ifsc} />
    </div>
  );
}

function ImportRow({
  label,
  hint,
  onImport,
  isPending,
}: {
  label: string;
  hint: string;
  onImport: (file: File) => void;
  isPending: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-foreground/50">{hint}</p>
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="flex-1 text-xs text-foreground/70 file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!file || isPending}
          onClick={() => file && onImport(file)}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Import
        </Button>
      </div>
    </div>
  );
}

function TaxCodeImportCard({ count }: { count?: { hsn: number; sac: number } }) {
  const { show } = useToast();
  const importTaxCodes = useImportTaxCodes();

  async function handle(type: "HSN" | "SAC", file: File) {
    try {
      const res = await importTaxCodes.mutateAsync({ type, file });
      show(`Imported ${res.imported} ${type} codes`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : `Could not import ${type} codes`, "error");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">HSN / SAC codes</h2>
      <p className="mb-4 text-sm text-foreground/60">
        {count ? `${count.hsn} HSN + ${count.sac} SAC codes loaded` : "None loaded yet"} — powers autocomplete on the
        product HSN/SAC field.
      </p>
      <div className="flex flex-col gap-3">
        <ImportRow
          label="HSN codes"
          hint='CSV columns: code, description, gstRate (optional). Source: the CBIC HSN directory.'
          onImport={(f) => handle("HSN", f)}
          isPending={importTaxCodes.isPending}
        />
        <ImportRow
          label="SAC codes"
          hint='CSV columns: code, description, gstRate (optional). Source: the CBIC SAC directory.'
          onImport={(f) => handle("SAC", f)}
          isPending={importTaxCodes.isPending}
        />
      </div>
    </Card>
  );
}

function PinCodeImportCard({ count }: { count?: number }) {
  const { show } = useToast();
  const importPincodes = useImportPincodes();

  async function handle(file: File) {
    try {
      const res = await importPincodes.mutateAsync(file);
      show(`Imported ${res.imported} PIN codes`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not import PIN codes", "error");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">PIN codes</h2>
      <p className="mb-4 text-sm text-foreground/60">
        {count ? `${count} PIN codes loaded` : "None loaded yet"} — enables city/state autofill from a PIN code in
        Company settings.
      </p>
      <ImportRow
        label="PIN code directory"
        hint="CSV columns: pincode, area, district, state. Source: the India Post / data.gov.in PIN code directory."
        onImport={handle}
        isPending={importPincodes.isPending}
      />
    </Card>
  );
}

function IfscCard({ count }: { count?: number }) {
  const { show } = useToast();
  const importIfsc = useImportIfsc();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<IfscRecord | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleImport(file: File) {
    try {
      const res = await importIfsc.mutateAsync(file);
      show(`Imported ${res.imported} IFSC codes`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not import IFSC codes", "error");
    }
  }

  async function lookup() {
    if (!query.trim()) return;
    setSearching(true);
    setResult(null);
    try {
      const record = await api.get<IfscRecord>(`/masters/ifsc/${encodeURIComponent(query.trim().toUpperCase())}`);
      setResult(record);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "IFSC code not found", "info");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">IFSC codes</h2>
      <p className="mb-4 text-sm text-foreground/60">
        {count ? `${count} IFSC codes loaded` : "None loaded yet"} — a standalone bank/branch lookup tool.
      </p>
      <ImportRow
        label="IFSC directory"
        hint="CSV columns: ifsc, bank, branch, address, district, state. Source: the RBI IFSC directory."
        onImport={handleImport}
        isPending={importIfsc.isPending}
      />
      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="Look up an IFSC code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. SBIN0001234"
          />
        </div>
        <Button type="button" variant="secondary" onClick={lookup} disabled={searching} aria-label="Search IFSC">
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {result && (
        <div className="mt-3 rounded-lg bg-surface-muted p-3 text-sm text-foreground/80">
          <p className="font-medium text-foreground">{result.bank}</p>
          <p>{result.branch}</p>
          <p className="text-foreground/60">{result.address}</p>
          <p className="text-foreground/60">
            {[result.district, result.state].filter(Boolean).join(", ")}
          </p>
        </div>
      )}
    </Card>
  );
}
