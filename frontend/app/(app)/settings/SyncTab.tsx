"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { api, describeApiError } from "@/lib/api";

interface Cfg { role: "none" | "branch" | "hub"; hubUrl: string; branchCode: string; secretSet: boolean; lastSyncAt: string | null }

// Optional multi-branch mode. Everything stays on the owner's own servers:
// branches push encrypted stock + daily sales to the hub; the hub shows the
// consolidated view and coordinates stock transfers (see the Branches page).
export function SyncTab() {
  const { show } = useToast();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { data } = useQuery({ queryKey: ["sync-config"], queryFn: () => api.get<Cfg>("/sync") });
  const [f, setF] = useState<{ role: string; hubUrl: string; code: string; secret: string } | null>(null);
  const cur = f ?? (data && { role: data.role, hubUrl: data.hubUrl, code: data.branchCode, secret: "" });

  const save = useMutation({
    mutationFn: () => withPasswordConfirm("change branch sync settings", (confirmPassword) =>
      api.put("/sync", { role: cur!.role, hubUrl: cur!.hubUrl, branchCode: cur!.code, ...(cur!.secret ? { secret: cur!.secret } : {}), confirmPassword })),
    onSuccess: (r) => { if (r) { show("Saved", "success"); setF(null); qc.invalidateQueries({ queryKey: ["sync-config"] }); qc.invalidateQueries({ queryKey: ["shop-settings"] }); } },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  const now = useMutation({
    mutationFn: () => api.post<{ pushed?: number; skipped?: boolean }>("/sync/now"),
    onSuccess: (r) => { show(r.skipped ? "Nothing to sync — set this up as a branch first" : `Synced ${r.pushed} products`, "success"); qc.invalidateQueries({ queryKey: ["sync-config"] }); },
    onError: (e) => show(describeApiError(e, "Sync failed"), "error"),
  });
  if (!cur) return <p className="text-sm text-foreground-muted">Loading…</p>;
  const set = (patch: Partial<typeof cur>) => setF({ ...cur, ...patch });

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">Multi-branch &amp; franchise</h2>
      <p className="text-sm text-foreground-muted">Off by default — a single shop needs none of this. Data only ever flows between your own machines, end-to-end encrypted with a secret you control.</p>
      <Select label="This installation is" value={cur.role} onChange={(e) => set({ role: e.target.value })} options={[{ value: "none", label: "A standalone shop" }, { value: "branch", label: "A branch — report to a hub" }, { value: "hub", label: "The hub — consolidate branches here" }]} />
      {cur.role === "branch" && (
        <>
          <Field label="Hub address (https://…)" type="url" value={cur.hubUrl} onChange={(e) => set({ hubUrl: e.target.value })} />
          <Field label="Branch code" value={cur.code} onChange={(e) => set({ code: e.target.value })} />
          <Field label="Sync secret (from the hub)" type="password" autoComplete="off" placeholder={data?.secretSet ? "•••••••• stored — leave blank to keep" : ""} value={cur.secret} onChange={(e) => set({ secret: e.target.value })} />
        </>
      )}
      {cur.role === "hub" && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Open <b>Branches</b> in the sidebar to add branches (you&apos;ll get each branch&apos;s sync secret once) and create franchisor read-only logins on the Team page.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        {data?.role === "branch" && <Button variant="secondary" onClick={() => now.mutate()} disabled={now.isPending}>Sync now</Button>}
        {data?.lastSyncAt && <span className="text-xs text-foreground-muted">last sync {new Date(data.lastSyncAt).toLocaleString()}</span>}
      </div>
    </Card>
  );
}
