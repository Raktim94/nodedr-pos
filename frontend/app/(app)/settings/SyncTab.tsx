"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";
import { api, describeApiError } from "@/lib/api";

interface Cfg { role: "none" | "branch" | "hub"; hubUrl: string; branchCode: string; secretSet: boolean; lastSyncAt: string | null }

// Optional multi-branch mode. Everything stays on the owner's own servers:
// branches push encrypted stock + daily sales to the hub; the hub shows the
// consolidated view and coordinates stock transfers (see the Branches page).
export function SyncTab() {
  const { show } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { data } = useQuery({ queryKey: ["sync-config"], queryFn: () => api.get<Cfg>("/sync") });
  const [f, setF] = useState<{ role: string; hubUrl: string; code: string; secret: string } | null>(null);
  const cur = f ?? (data && { role: data.role, hubUrl: data.hubUrl, code: data.branchCode, secret: "" });

  const save = useMutation({
    mutationFn: () => withPasswordConfirm(t("settings.sync.confirmSave"), (confirmPassword) =>
      api.put("/sync", { role: cur!.role, hubUrl: cur!.hubUrl, branchCode: cur!.code, ...(cur!.secret ? { secret: cur!.secret } : {}), confirmPassword })),
    onSuccess: (r) => { if (r) { show(t("settings.sync.saved"), "success"); setF(null); qc.invalidateQueries({ queryKey: ["sync-config"] }); qc.invalidateQueries({ queryKey: ["shop-settings"] }); } },
    onError: (e) => show(describeApiError(e, t("settings.sync.saveFailed")), "error"),
  });
  const now = useMutation({
    mutationFn: () => api.post<{ pushed?: number; skipped?: boolean }>("/sync/now"),
    onSuccess: (r) => { show(r.skipped ? t("settings.sync.nothingToSync") : t("settings.sync.syncedProducts", { count: String(r.pushed) }), "success"); qc.invalidateQueries({ queryKey: ["sync-config"] }); },
    onError: (e) => show(describeApiError(e, t("settings.sync.syncFailed")), "error"),
  });
  if (!cur) return <p className="text-sm text-foreground-muted">{t("settings.sync.loading")}</p>;
  const set = (patch: Partial<typeof cur>) => setF({ ...cur, ...patch });

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">{t("settings.sync.title")}</h2>
      <p className="text-sm text-foreground-muted">{t("settings.sync.desc")}</p>
      <Select label={t("settings.sync.roleLabel")} value={cur.role} onChange={(e) => set({ role: e.target.value })} options={[{ value: "none", label: t("settings.sync.roleNone") }, { value: "branch", label: t("settings.sync.roleBranch") }, { value: "hub", label: t("settings.sync.roleHub") }]} />
      {cur.role === "branch" && (
        <>
          <Field label={t("settings.sync.hubUrl")} type="url" value={cur.hubUrl} onChange={(e) => set({ hubUrl: e.target.value })} />
          <Field label={t("settings.sync.branchCode")} value={cur.code} onChange={(e) => set({ code: e.target.value })} />
          <Field label={t("settings.sync.secret")} type="password" autoComplete="off" placeholder={data?.secretSet ? t("settings.sync.storedPlaceholder") : ""} value={cur.secret} onChange={(e) => set({ secret: e.target.value })} />
        </>
      )}
      {cur.role === "hub" && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">{t("settings.sync.hubHintA")}<b>{t("settings.sync.hubHintB")}</b>{t("settings.sync.hubHintC")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("settings.sync.save")}</Button>
        {data?.role === "branch" && <Button variant="secondary" onClick={() => now.mutate()} disabled={now.isPending}>{t("settings.sync.syncNow")}</Button>}
        {data?.lastSyncAt && <span className="text-xs text-foreground-muted">{t("settings.sync.lastSync", { time: new Date(data.lastSyncAt).toLocaleString() })}</span>}
      </div>
    </Card>
  );
}
