"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";
import { useUpdateStatus } from "@/hooks/useUpdate";
import { api, ApiError } from "@/lib/api";

type Phase = "idle" | "updating" | "unchanged" | "failed";

const POLL_MS = 3000;
const GIVE_UP_MS = 6 * 60_000;

export function UpdatesTab() {
  const { data, isLoading, isFetching, refetch } = useUpdateStatus(true);
  const qc = useQueryClient();
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function checkNow() {
    // ?refresh=1 skips the backend's 10-minute cache.
    try {
      const fresh = await api.get("/update/status?refresh=1");
      qc.setQueryData(["update-status"], fresh);
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.updates.checkFailed"), "error");
    }
  }

  // The backend and frontend containers are replaced during an update, so the
  // app goes dark for a short while. Poll /health: once it has been down and
  // is back (or reports a different version) the new version is running.
  function waitForRestart(startVersion: string) {
    const started = Date.now();
    let sawDown = false;
    timer.current = setInterval(async () => {
      let version: string | null = null;
      try {
        const h = await api.get<{ status: string; version?: string }>("/health");
        version = h.version ?? null;
      } catch {
        sawDown = true;
        return;
      }
      // Backend is up: ask the updater whether it gave up (e.g. no internet to
      // download the new version) — otherwise we'd just wait for nothing.
      try {
        const p = await api.get<{ state: string; error?: string | null }>("/update/progress");
        if (p.state === "error") {
          if (timer.current) clearInterval(timer.current);
          setFailure(p.error || null);
          setPhase("failed");
          return;
        }
      } catch {}
      if ((version && version !== startVersion) || sawDown) {
        if (timer.current) clearInterval(timer.current);
        window.location.reload();
      } else if (Date.now() - started > GIVE_UP_MS) {
        if (timer.current) clearInterval(timer.current);
        setPhase("unchanged");
        qc.invalidateQueries({ queryKey: ["update-status"] });
      }
    }, POLL_MS);
  }

  async function update() {
    if (!data) return;
    setFailure(null);
    const ok = await withPasswordConfirm(t("settings.updates.confirmUpdate"), async (confirmPassword) => {
      await api.post("/update/apply", { confirmPassword });
      return true;
    });
    if (!ok) return;
    setPhase("updating");
    waitForRestart(data.current);
  }

  if (isLoading) return <p className="text-sm text-foreground/50">{t("settings.updates.checking")}</p>;

  return (
    <Card className="flex max-w-2xl flex-col gap-5 p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("settings.updates.title")}</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {t("settings.updates.installedVersion")} <span className="tabular font-medium text-foreground">{data?.current ?? "—"}</span>
          {data?.latest && (
            <>
              {" "}· {t("settings.updates.latestLabel")} <span className="tabular font-medium text-foreground">{data.latest}</span>
            </>
          )}
        </p>
      </div>

      {phase === "failed" && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="font-medium text-danger">{t("settings.updates.failedTitle")}</p>
          <p className="mt-1 break-words text-foreground-muted">{failure ?? t("settings.updates.failedGeneric")} {t("settings.updates.failedHint")}</p>
        </div>
      )}

      {phase === "updating" ? (
        <div className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft p-4 text-sm">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">{t("settings.updates.updatingTitle")}</p>
            <p className="mt-1 text-foreground-muted">{t("settings.updates.updatingHint")}</p>
          </div>
        </div>
      ) : data?.updateAvailable ? (
        <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-soft p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ArrowUpCircle className="h-4 w-4 text-brand" aria-hidden="true" />
            {t("settings.updates.available", { version: data.latest ?? "" })}
          </p>
          {data.canUpdate ? (
            <div>
              <Button onClick={update}>{t("settings.updates.updateNow")}</Button>
              <p className="mt-2 text-xs text-foreground-muted">
                {t("settings.updates.updateHint")}
              </p>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">
              {t("settings.updates.cantUpdate")}{" "}
              <a href={data.releaseUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t("settings.updates.releasesPage")}</a>.
            </p>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
          {phase === "unchanged" ? t("settings.updates.unchanged") : t("settings.updates.latestOk")}
        </p>
      )}

      {data?.checkError && !data.latest && (
        <p className="text-xs text-warning">{t("settings.updates.checkError", { error: data.checkError })}</p>
      )}

      <div>
        <Button variant="secondary" onClick={checkNow} disabled={isFetching || phase === "updating"}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("settings.updates.checkNow")}
        </Button>
        {data?.checkedAt && <span className="ml-3 text-xs text-foreground-muted">{t("settings.updates.lastChecked", { time: new Date(data.checkedAt).toLocaleTimeString() })}</span>}
      </div>
    </Card>
  );
}
