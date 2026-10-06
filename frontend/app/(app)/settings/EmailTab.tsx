"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { api, describeApiError } from "@/lib/api";

interface Cfg { reportEmail: string; reportFrequency: "off" | "daily" | "weekly"; smtp: { configured: boolean; host: string; port: number; secure: boolean; user: string; from: string } }

export function EmailTab() {
  const { show } = useToast();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { data } = useQuery({ queryKey: ["email-reports"], queryFn: () => api.get<Cfg>("/email-reports") });
  const [f, setF] = useState<{ email: string; freq: string; host: string; port: string; secure: boolean; user: string; pass: string; from: string } | null>(null);
  const cur = f ?? (data && { email: data.reportEmail, freq: data.reportFrequency, host: data.smtp.host, port: String(data.smtp.port), secure: data.smtp.secure, user: data.smtp.user, pass: "", from: data.smtp.from });

  const save = useMutation({
    mutationFn: () => withPasswordConfirm("save e-mail report settings", (confirmPassword) =>
      api.put("/email-reports", { reportEmail: cur!.email, reportFrequency: cur!.freq, ...(cur!.host ? { smtp: { host: cur!.host, port: Number(cur!.port) || 587, secure: cur!.secure, user: cur!.user || undefined, from: cur!.from || undefined, ...(cur!.pass ? { pass: cur!.pass } : {}) } } : {}), confirmPassword })),
    onSuccess: (r) => { if (r) { show("Saved", "success"); setF(null); qc.invalidateQueries({ queryKey: ["email-reports"] }); } },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  const test = useMutation({
    mutationFn: () => api.post("/email-reports/send-now", { kind: "daily" }),
    onSuccess: () => show("Report sent — check your inbox", "success"),
    onError: (e) => show(describeApiError(e, "Could not send"), "error"),
  });
  if (!cur) return <p className="text-sm text-foreground-muted">Loading…</p>;
  const set = (patch: Partial<typeof cur>) => setF({ ...cur, ...patch });

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">Scheduled sales e-mail</h2>
      <p className="text-sm text-foreground-muted">A summary of revenue, profit, top products and low stock, sent after 8 am — daily for yesterday, or on Mondays for last week. Uses your own mail account; the password is stored encrypted.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Send to" type="email" value={cur.email} onChange={(e) => set({ email: e.target.value })} />
        <Select label="How often" value={cur.freq} onChange={(e) => set({ freq: e.target.value })} options={[{ value: "off", label: "Off" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly (Mondays)" }]} />
        <Field label="SMTP host" placeholder="smtp.gmail.com" value={cur.host} onChange={(e) => set({ host: e.target.value })} />
        <Field label="Port" type="number" value={cur.port} onChange={(e) => set({ port: e.target.value })} />
        <Field label="SMTP user" value={cur.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
        <Field label="SMTP password" type="password" placeholder={data?.smtp.configured ? "•••••••• stored — leave blank to keep" : ""} value={cur.pass} onChange={(e) => set({ pass: e.target.value })} autoComplete="new-password" />
        <Field label="From address" placeholder="reports@yourshop.com" value={cur.from} onChange={(e) => set({ from: e.target.value })} />
      </div>
      <Toggle label="Use TLS from the start (port 465)" checked={cur.secure} onChange={(v) => set({ secure: v })} />
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !data?.smtp.configured}>Send a test now</Button>
      </div>
    </Card>
  );
}
