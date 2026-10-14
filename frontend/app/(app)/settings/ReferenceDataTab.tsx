"use client";

import { useState } from "react";
import { Search, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { useTranslation } from "@/components/I18nProvider";
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
  const { t } = useTranslation();
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
          {t("settings.reference.import")}
        </Button>
      </div>
    </div>
  );
}

function TaxCodeImportCard({ count }: { count?: { hsn: number; sac: number } }) {
  const { show } = useToast();
  const { t } = useTranslation();
  const importTaxCodes = useImportTaxCodes();

  async function handle(type: "HSN" | "SAC", file: File) {
    try {
      const res = await importTaxCodes.mutateAsync({ type, file });
      show(t("settings.reference.importedCodes", { count: res.imported, type }), "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.reference.importCodesFailed", { type }), "error");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">{t("settings.reference.hsnTitle")}</h2>
      <p className="mb-4 text-sm text-foreground/60">
        {count ? t("settings.reference.hsnLoaded", { hsn: count.hsn, sac: count.sac }) : t("settings.reference.noneLoaded")} {t("settings.reference.hsnHint")}
      </p>
      <div className="flex flex-col gap-3">
        <ImportRow
          label={t("settings.reference.hsnLabel")}
          hint={t("settings.reference.hsnCsv")}
          onImport={(f) => handle("HSN", f)}
          isPending={importTaxCodes.isPending}
        />
        <ImportRow
          label={t("settings.reference.sacLabel")}
          hint={t("settings.reference.sacCsv")}
          onImport={(f) => handle("SAC", f)}
          isPending={importTaxCodes.isPending}
        />
      </div>
    </Card>
  );
}

function PinCodeImportCard({ count }: { count?: number }) {
  const { show } = useToast();
  const { t } = useTranslation();
  const importPincodes = useImportPincodes();

  async function handle(file: File) {
    try {
      const res = await importPincodes.mutateAsync(file);
      show(t("settings.reference.importedPins", { count: res.imported }), "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.reference.importPinsFailed"), "error");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">{t("settings.reference.pinTitle")}</h2>
      <p className="mb-4 text-sm text-foreground/60">
        {count ? t("settings.reference.pinLoaded", { count }) : t("settings.reference.noneLoaded")} {t("settings.reference.pinHint")}
      </p>
      <ImportRow
        label={t("settings.reference.pinLabel")}
        hint={t("settings.reference.pinCsv")}
        onImport={handle}
        isPending={importPincodes.isPending}
      />
    </Card>
  );
}

function IfscCard({ count }: { count?: number }) {
  const { show } = useToast();
  const { t } = useTranslation();
  const importIfsc = useImportIfsc();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<IfscRecord | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleImport(file: File) {
    try {
      const res = await importIfsc.mutateAsync(file);
      show(t("settings.reference.importedIfsc", { count: res.imported }), "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.reference.importIfscFailed"), "error");
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
      show(err instanceof ApiError ? err.message : t("settings.reference.ifscNotFound"), "info");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-base font-semibold text-foreground">{t("settings.reference.ifscTitle")}</h2>
      <p className="mb-4 text-sm text-foreground/60">
        {count ? t("settings.reference.ifscLoaded", { count }) : t("settings.reference.noneLoaded")} {t("settings.reference.ifscHint")}
      </p>
      <ImportRow
        label={t("settings.reference.ifscLabel")}
        hint={t("settings.reference.ifscCsv")}
        onImport={handleImport}
        isPending={importIfsc.isPending}
      />
      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field
            label={t("settings.reference.lookupLabel")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. SBIN0001234"
          />
        </div>
        <Button type="button" variant="secondary" onClick={lookup} disabled={searching} aria-label={t("settings.reference.searchIfsc")}>
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
