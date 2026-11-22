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
import { useTranslation } from "@/components/I18nProvider";
import { api, describeApiError } from "@/lib/api";

interface Cfg { reportEmail: string; reportFrequency: "off" | "daily" | "weekly"; smtp: { configured: boolean; host: string; port: number; secure: boolean; user: string; from: string } }

export function EmailTab() {
  const { show } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { data } = useQuery({ queryKey: ["email-reports"], queryFn: () => api.get<Cfg>("/email-reports") });
  const [f, setF] = useState<{ email: string; freq: string; host: string; port: string; secure: boolean; user: string; pass: string; from: string } | null>(null);
  const cur = f ?? (data && { email: data.reportEmail, freq: data.reportFrequency, host: data.smtp.host, port: String(data.smtp.port), secure: data.smtp.secure, user: data.smtp.user, pass: "", from: data.smtp.from });

  const save = useMutation({
    mutationFn: () => withPasswordConfirm(t("settings.email.confirmSave"), (confirmPassword) =>
      api.put("/email-reports", { reportEmail: cur!.email, reportFrequency: cur!.freq, ...(cur!.host ? { smtp: { host: cur!.host, port: Number(cur!.port) || 587, secure: cur!.secure, user: cur!.user || undefined, from: cur!.from || undefined, ...(cur!.pass ? { pass: cur!.pass } : {}) } } : {}), confirmPassword })),
    onSuccess: (r) => { if (r) { show(t("settings.email.saved"), "success"); setF(null); qc.invalidateQueries({ queryKey: ["email-reports"] }); } },
    onError: (e) => show(describeApiError(e, t("settings.email.saveFailed")), "error"),
  });
  const test = useMutation({
    mutationFn: () => api.post("/email-reports/send-now", { kind: "daily" }),
    onSuccess: () => show(t("settings.email.testSent"), "success"),
    onError: (e) => show(describeApiError(e, t("settings.email.sendFailed")), "error"),
  });
  if (!cur) return <p className="text-sm text-foreground-muted">{t("settings.email.loading")}</p>;
  const set = (patch: Partial<typeof cur>) => setF({ ...cur, ...patch });

  return (
    <Card className="flex max-w-2xl flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">{t("settings.email.title")}</h2>
      <p className="text-sm text-foreground-muted">{t("settings.email.desc")}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("settings.email.sendTo")} type="email" value={cur.email} onChange={(e) => set({ email: e.target.value })} />
        <Select label={t("settings.email.frequency")} value={cur.freq} onChange={(e) => set({ freq: e.target.value })} options={[{ value: "off", label: t("settings.email.freqOff") }, { value: "daily", label: t("settings.email.freqDaily") }, { value: "weekly", label: t("settings.email.freqWeekly") }]} />
        <Field label={t("settings.email.smtpHost")} placeholder="smtp.gmail.com" value={cur.host} onChange={(e) => set({ host: e.target.value })} />
        <Field label={t("settings.email.port")} type="number" value={cur.port} onChange={(e) => set({ port: e.target.value })} />
        <Field label={t("settings.email.smtpUser")} value={cur.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
        <Field label={t("settings.email.smtpPassword")} type="password" placeholder={data?.smtp.configured ? t("settings.email.storedPlaceholder") : ""} value={cur.pass} onChange={(e) => set({ pass: e.target.value })} autoComplete="new-password" />
        <Field label={t("settings.email.fromAddress")} placeholder="reports@yourshop.com" value={cur.from} onChange={(e) => set({ from: e.target.value })} />
      </div>
      <Toggle label={t("settings.email.tls")} checked={cur.secure} onChange={(v) => set({ secure: v })} />
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("settings.email.save")}</Button>
        <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !data?.smtp.configured}>{t("settings.email.sendTest")}</Button>
      </div>
    </Card>
  );
}
