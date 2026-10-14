"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import type { ShopSettings } from "@/lib/types";
import { useTranslation } from "@/components/I18nProvider";
import { useSaver } from "./useSaver";

// Optional features: off by default so a shop only sees what it uses.
export function FeaturesTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const { t } = useTranslation();
  const [serial, setSerial] = useState(settings.serialTracking);
  return (
    <Card className="flex max-w-2xl flex-col gap-5 p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.features.title")}</h2>
          <p className="mt-1 text-sm text-foreground-muted">{t("settings.features.desc1a")}<b>{t("settings.features.desc1b")}</b>{t("settings.features.desc1c")}<b>{t("settings.features.desc1d")}</b>{t("settings.features.desc1e")}</p>
          <p className="mt-2 text-sm text-foreground-muted">{t("settings.features.desc2")}</p>
        </div>
      </div>
      <Toggle label={t("settings.features.toggleLabel")} description={serial ? t("settings.features.descOn") : t("settings.features.descOff")} checked={serial} onChange={setSerial} />
      <div>
        <Button onClick={() => save({ serialTracking: serial })} disabled={serial === settings.serialTracking}>
          {t("settings.features.save")}
        </Button>
      </div>
    </Card>
  );
}
