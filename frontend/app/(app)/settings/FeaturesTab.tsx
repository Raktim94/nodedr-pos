"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import type { ShopSettings } from "@/lib/types";
import { useSaver } from "./useSaver";

// Optional features: off by default so a shop only sees what it uses.
export function FeaturesTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const [serial, setSerial] = useState(settings.serialTracking);
  return (
    <Card className="flex max-w-2xl flex-col gap-5 p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold">IMEI / serial numbers &amp; warranty</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            For shops that sell phones, laptops or appliances. When on, selling a product you flag as <b>IMEI-tracked</b> asks for the IMEI / serial number of each unit <b>at the moment of sale</b> — nothing has to be entered into stock beforehand. The number and its warranty period are printed on the bill, and you can look up any unit&apos;s warranty later by scanning it.
          </p>
          <p className="mt-2 text-sm text-foreground-muted">Leave it off if you don&apos;t need it: the IMEI fields, the Warranty page and the extra prompts at checkout all stay hidden.</p>
        </div>
      </div>
      <Toggle label="Track IMEI / serial numbers when selling" description={serial ? "On — flag products as IMEI-tracked in Inventory → edit product." : "Off"} checked={serial} onChange={setSerial} />
      <div>
        <Button onClick={() => save({ serialTracking: serial })} disabled={serial === settings.serialTracking}>
          Save
        </Button>
      </div>
    </Card>
  );
}
