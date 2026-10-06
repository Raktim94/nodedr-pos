"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { api, describeApiError } from "@/lib/api";
import { useCurrencies } from "@/hooks/useShopSettings";
import type { ShopSettings } from "@/lib/types";
import { useSaver } from "./useSaver";

export function PaymentsTab({ settings }: { settings: ShopSettings }) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <UpiCard settings={settings} />
      <TerminalCard />
      <FxCard base={settings.currencyCode} />
    </div>
  );
}

function UpiCard({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const [upi, setUpi] = useState(settings.upiId ?? "");
  const [drawer, setDrawer] = useState(settings.cashDrawer);
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">UPI &amp; cash drawer</h2>
      <Field label="Your UPI id (VPA)" placeholder="shop@okhdfcbank" value={upi} onChange={(e) => setUpi(e.target.value.trim())} />
      <p className="-mt-2 text-xs text-foreground-muted">At checkout the POS shows a QR for the exact amount, and the A4 invoice prints one for any balance due. INR shops only.</p>
      <Toggle label="Open the cash drawer on cash sales" description="Sends the standard drawer-kick pulse through the receipt printer's RJ11 port." checked={drawer} onChange={setDrawer} />
      <div><Button onClick={() => save({ upiId: upi, cashDrawer: drawer })}>Save</Button></div>
    </Card>
  );
}

function TerminalCard() {
  const { show } = useToast();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { data } = useQuery({ queryKey: ["terminal-config"], queryFn: () => api.get<{ provider: string; configured: boolean; readerId: string; deviceId: string; sandbox: boolean }>("/payments/terminal-config") });
  const [provider, setProvider] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [readerId, setReaderId] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<boolean | null>(null);
  const p = provider ?? data?.provider ?? "none";
  const rid = readerId ?? (p === "square" ? data?.deviceId : data?.readerId) ?? "";

  const saveCfg = useMutation({
    mutationFn: () => withPasswordConfirm("save card-terminal settings", (confirmPassword) =>
      api.put("/payments/terminal-config", { provider: p, ...(secret ? { secret } : {}), ...(p === "stripe" ? { readerId: rid } : {}), ...(p === "square" ? { deviceId: rid, sandbox: sandbox ?? data?.sandbox ?? false } : {}), confirmPassword })),
    onSuccess: (r) => { if (r) { show("Saved", "success"); setSecret(""); qc.invalidateQueries({ queryKey: ["terminal-config"] }); qc.invalidateQueries({ queryKey: ["shop-settings"] }); } },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">Card terminal</h2>
      <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">Experimental: written against the Stripe Terminal and Square APIs but not yet tested on a live reader from this project. Pilot it with a test key and a real device before relying on it.</p>
      <Select label="Provider" value={p} onChange={(e) => setProvider(e.target.value)} options={[{ value: "none", label: "None (card sales are recorded manually)" }, { value: "stripe", label: "Stripe Terminal" }, { value: "square", label: "Square Terminal" }]} />
      {p !== "none" && (
        <>
          <Field label={p === "stripe" ? "Stripe secret key (sk_…)" : "Square access token"} type="password" autoComplete="off" placeholder={data?.configured ? "•••••••• stored — leave blank to keep" : ""} value={secret} onChange={(e) => setSecret(e.target.value)} />
          <Field label={p === "stripe" ? "Reader id (tmr_…)" : "Device id"} value={rid} onChange={(e) => setReaderId(e.target.value)} />
          {p === "square" && <Toggle label="Sandbox" checked={sandbox ?? data?.sandbox ?? false} onChange={setSandbox} />}
        </>
      )}
      <div><Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>Save terminal</Button></div>
    </Card>
  );
}

function FxCard({ base }: { base: string }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const { data: currencies } = useCurrencies();
  const { data: fx } = useQuery({ queryKey: ["fx"], queryFn: () => api.get<{ base: string; rates: Record<string, number>; updatedAt: string | null }>("/payments/fx") });
  const [rates, setRates] = useState<Record<string, string> | null>(null);
  const [add, setAdd] = useState("USD");
  const cur = rates ?? Object.fromEntries(Object.entries(fx?.rates ?? {}).map(([k, v]) => [k, String(v)]));

  const saveRates = useMutation({
    mutationFn: () => api.put("/payments/fx", { rates: Object.fromEntries(Object.entries(cur).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) }),
    onSuccess: () => { show("Rates saved", "success"); setRates(null); qc.invalidateQueries({ queryKey: ["fx"] }); },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  const refresh = useMutation({
    mutationFn: () => api.post("/payments/fx/refresh"),
    onSuccess: () => { show("Live rates fetched", "success"); setRates(null); qc.invalidateQueries({ queryKey: ["fx"] }); },
    onError: (e) => show(describeApiError(e, "Could not fetch live rates"), "error"),
  });

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">Foreign-currency sales</h2>
      <p className="text-sm text-foreground-muted">Let a customer pay in another currency. Enter how many <b>{base}</b> one unit of it is worth (manual works fully offline), or fetch live rates when online.</p>
      <div className="flex flex-col gap-2">
        {Object.entries(cur).map(([code, v]) => (
          <div key={code} className="flex items-center gap-2 text-sm">
            <span className="w-14 font-medium">1 {code} =</span>
            <input aria-label={`Rate for ${code}`} type="number" min={0} step="0.0001" value={v} onChange={(e) => setRates({ ...cur, [code]: e.target.value })} className="tabular w-32 rounded-lg border border-border bg-surface px-2 py-1.5" />
            <span className="text-foreground-muted">{base}</span>
            <Button variant="ghost" onClick={() => { const n = { ...cur }; delete n[code]; setRates(n); }}>Remove</Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select aria-label="Currency to add" value={add} onChange={(e) => setAdd(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
            {Object.keys(currencies ?? {}).filter((c) => c !== base && !(c in cur)).map((c) => <option key={c}>{c}</option>)}
          </select>
          <Button variant="secondary" onClick={() => setRates({ ...cur, [add]: "1" })}>Add currency</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => saveRates.mutate()} disabled={saveRates.isPending}>Save rates</Button>
        <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Fetch live rates</Button>
        {fx?.updatedAt && <span className="text-xs text-foreground-muted">updated {new Date(fx.updatedAt).toLocaleString()}</span>}
      </div>
    </Card>
  );
}
