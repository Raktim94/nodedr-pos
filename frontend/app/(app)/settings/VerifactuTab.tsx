"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { api, describeApiError } from "@/lib/api";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";

interface Cfg {
  enabled: boolean;
  environment: "TEST" | "PRODUCTION";
  nif: string;
  series: string;
  nextNumber: number;
  hasCertificate: boolean;
  certSubject: string | null;
  certExpires: string | null;
  problems: string[];
  counts: Record<string, number>;
}
interface RecordRow {
  id: number;
  seq: number;
  invoiceType: string;
  invoiceNumber: string;
  issueDate: string;
  totalCents: number;
  status: "PENDING" | "ACCEPTED" | "ACCEPTED_WITH_ERRORS" | "REJECTED" | "ERROR";
  errorCode: string | null;
  errorText: string | null;
}
type Verify = { ok: true; checked: number } | { ok: false; checked: number; brokenAt: number; environment: string; reason: string };

const STATUS: Record<RecordRow["status"], string> = {
  PENDING: "Waiting to send",
  ACCEPTED: "Accepted",
  ACCEPTED_WITH_ERRORS: "Accepted with errors",
  REJECTED: "Rejected",
  ERROR: "Will retry",
};

export function VerifactuTab() {
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["verifactu"] });
  const { data } = useQuery({ queryKey: ["verifactu", "settings"], queryFn: () => api.get<Cfg>("/verifactu/settings") });
  const recs = useQuery({
    queryKey: ["verifactu", "records"],
    queryFn: () => api.get<{ items: RecordRow[]; total: number }>("/verifactu/records?take=50"),
    refetchInterval: 30_000,
  });
  const [f, setF] = useState<{ enabled: boolean; environment: "TEST" | "PRODUCTION"; nif: string; series: string } | null>(null);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const cur = f ?? (data && { enabled: data.enabled, environment: data.environment, nif: data.nif, series: data.series });

  const save = useMutation({
    mutationFn: () => withPasswordConfirm(t("settings.verifactu.confirmSave"), (confirmPassword) => api.put<Cfg>("/verifactu/settings", { ...cur, confirmPassword })),
    onSuccess: (r) => {
      if (!r) return;
      show("Saved", "success");
      setF(null);
      refresh();
    },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  const upload = useMutation({
    mutationFn: (chosen: File) =>
      withPasswordConfirm(t("settings.verifactu.confirmCertificate"), (confirmPassword) => {
        const form = new FormData();
        form.append("file", chosen);
        form.append("password", password);
        form.append("confirmPassword", confirmPassword);
        return api.upload<Cfg>("/verifactu/certificate", form);
      }),
    onSuccess: (r) => {
      if (!r) return;
      show("Certificate saved", "success");
      setPassword("");
      if (file.current) file.current.value = "";
      refresh();
    },
    onError: (e) => show(describeApiError(e, "Could not read the certificate"), "error"),
  });
  const send = useMutation({
    mutationFn: () => api.post<{ sent: number }>("/verifactu/send"),
    onSuccess: (r) => {
      show(r.sent ? `Sent ${r.sent} record${r.sent === 1 ? "" : "s"}` : "Nothing to send right now", "success");
      refresh();
    },
    onError: (e) => show(describeApiError(e, "Could not send"), "error"),
  });
  const verify = useMutation({
    mutationFn: () => api.get<Verify>("/verifactu/verify"),
    onSuccess: (r) =>
      setResult(
        r.ok
          ? `Chain intact: ${r.checked} record${r.checked === 1 ? "" : "s"} checked.`
          : `Chain broken at record ${r.brokenAt} (${r.environment.toLowerCase()}): ${r.reason}.`
      ),
    onError: (e) => show(describeApiError(e, "Could not check"), "error"),
  });

  if (!cur || !data) return <p className="text-sm text-foreground-muted">Loading…</p>;
  const set = (patch: Partial<typeof cur>) => setF({ ...cur, ...patch });
  const locked = Object.values(data.counts).some((n) => n > 0);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex max-w-2xl flex-col gap-4 p-6">
        <h2 className="text-base font-semibold">Spain VERI*FACTU</h2>
        <p className="text-sm text-foreground-muted">
          Every sale becomes a simplified invoice in a tamper-evident chain, the receipt prints the tax agency&rsquo;s QR code, and
          records are reported to the agency (AEAT) with your own certificate.
        </p>
        <div role="note" className="rounded-xl border border-border p-3 text-sm">
          <strong>Implemented, not certified.</strong> It has not been run against the live AEAT portal and NODEDR has not issued its
          Declaración Responsable. Test with AEAT&rsquo;s pre-production portal and ask your gestor before relying on it.
        </div>
        {data.problems.length > 0 && (
          <ul className="list-disc rounded-xl border border-danger/40 p-3 pl-7 text-sm text-danger">
            {data.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <Toggle label="Issue VERI*FACTU invoices (a sale cannot be completed without its record)" checked={cur.enabled} onChange={(v) => set({ enabled: v })} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Shop NIF / CIF" value={cur.nif} maxLength={9} disabled={locked} onChange={(e) => set({ nif: e.target.value.toUpperCase() })} />
          <Select
            label="Environment"
            value={cur.environment}
            onChange={(e) => set({ environment: e.target.value as "TEST" | "PRODUCTION" })}
            options={[
              { value: "TEST", label: "Test (AEAT pre-production)" },
              { value: "PRODUCTION", label: "Production" },
            ]}
          />
          <Field label="Invoice series" value={cur.series} maxLength={12} disabled={locked} onChange={(e) => set({ series: e.target.value })} />
          <p className="self-end text-sm text-foreground-muted">
            Next number: {data.series}-{String(data.nextNumber).padStart(6, "0")}. Test and production keep separate chains.
          </p>
        </div>
        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </div>
      </Card>

      <Card className="flex max-w-2xl flex-col gap-3 p-6">
        <h2 className="text-base font-semibold">Digital certificate</h2>
        <p className="text-sm text-foreground-muted">The company&rsquo;s electronic certificate (.p12 or .pfx), needed to report to AEAT. It is stored encrypted.</p>
        <p className="text-sm">
          {data.hasCertificate
            ? `Loaded: ${data.certSubject}${data.certExpires ? ` · expires ${new Date(data.certExpires).toLocaleDateString()}` : ""}`
            : "None uploaded yet. Records queue until one is."}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            Certificate file
            <input ref={file} type="file" accept=".p12,.pfx" />
          </label>
          <Field label="Certificate password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button
            variant="secondary"
            disabled={upload.isPending}
            onClick={() => {
              const chosen = file.current?.files?.[0];
              if (!chosen) return show("Choose the certificate file first", "error");
              upload.mutate(chosen);
            }}
          >
            Upload
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Invoice records</h2>
            <p className="text-sm text-foreground-muted">
              {Object.entries(data.counts)
                .map(([k, n]) => `${n} ${STATUS[k as RecordRow["status"]]?.toLowerCase() ?? k}`)
                .join(" · ") || "No records yet."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
              Check chain
            </Button>
            <Button variant="secondary" onClick={() => send.mutate()} disabled={send.isPending}>
              Send now
            </Button>
            <a href="/api/verifactu/export.xml" download>
              <Button variant="secondary">Export XML</Button>
            </a>
          </div>
        </div>
        {result && (
          <p role="status" className="text-sm">
            {result}
          </p>
        )}
        {!recs.data || recs.data.items.length === 0 ? (
          <p className="text-sm text-foreground-muted">Records appear here as sales are completed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-foreground-muted">
                <tr>
                  <th className="py-2 pr-4">Invoice</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {recs.data.items.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.invoiceNumber} <span className="text-foreground-muted">{r.invoiceType}</span>
                    </td>
                    <td className="py-2 pr-4">{r.issueDate}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{(r.totalCents / 100).toFixed(2)}</td>
                    <td className={`py-2 pr-4 ${r.status === "REJECTED" ? "text-danger" : ""}`}>
                      {STATUS[r.status]}
                      {r.errorText && (
                        <span className="block text-xs text-foreground-muted">
                          {r.errorCode ? `${r.errorCode}: ` : ""}
                          {r.errorText}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
