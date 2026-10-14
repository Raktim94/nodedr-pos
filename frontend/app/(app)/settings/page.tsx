"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useCurrencies, useShopSettings, useUpdateSettings } from "@/hooks/useShopSettings";
import { api, ApiError } from "@/lib/api";
import { gstStateFromGstin, isValidGstinFormat, isValidPanFormat } from "@/lib/masters";
import type { PinCodeRecord } from "@/hooks/useMasters";
import type { ShopSettings } from "@/lib/types";
import { useTranslation } from "@/components/I18nProvider";
import type { TranslationKey } from "@/lib/locales/en";
import { UsersPanel } from "./UsersPanel";
import { ReferenceDataTab } from "./ReferenceDataTab";
import { useSaver } from "./useSaver";
import { PaymentsTab } from "./PaymentsTab";
import { InvoiceTab } from "./InvoiceTab";
import { OnlineTab } from "./OnlineTab";
import { EmailTab } from "./EmailTab";
import { SyncTab } from "./SyncTab";
import { FeaturesTab } from "./FeaturesTab";
import { IntegrationsTab } from "./IntegrationsTab";
import { UpdatesTab } from "./UpdatesTab";

const TABS = [
  "Company",
  "Tax & Loyalty",
  "Receipt",
  "Features",
  "Invoice & signature",
  "Payments",
  "Online stores",
  "E-mail reports",
  "Branches",
  "Reference Data",
  "Integrations",
  "Password",
  "Staff",
  "Updates",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, TranslationKey> = {
  Company: "settings.tabs.company",
  "Tax & Loyalty": "settings.tabs.taxLoyalty",
  Receipt: "settings.tabs.receipt",
  Features: "settings.tabs.features",
  "Invoice & signature": "settings.tabs.invoiceSignature",
  Payments: "settings.tabs.payments",
  "Online stores": "settings.tabs.onlineStores",
  "E-mail reports": "settings.tabs.emailReports",
  Branches: "settings.tabs.branches",
  "Reference Data": "settings.tabs.referenceData",
  Integrations: "settings.tabs.integrations",
  Password: "settings.tabs.password",
  Staff: "settings.tabs.staff",
  Updates: "settings.tabs.updates",
};

export default function SettingsPage() {
  const { data: settings, isLoading, isError, error, refetch } = useShopSettings();
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("Company");

  // Deep link from the "Update available" banner: /settings?tab=Updates
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && (TABS as readonly string[]).includes(wanted)) setTab(wanted as Tab);
  }, []);

  if (isLoading) {
    return <p className="text-sm text-foreground/50">{t("settings.loading")}</p>;
  }

  // A successful response can legitimately be `null` (no ShopSettings row
  // yet, e.g. onboarding's step 2 was never finished) — that is NOT the
  // same as still loading, and must not fall into the spinner above forever.
  if (isError || !settings) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-danger">
          {isError
            ? error instanceof ApiError
              ? error.message
              : t("settings.errors.couldNotLoad")
            : t("settings.errors.noSetup")}
        </p>
        {isError ? (
          <Button variant="secondary" onClick={() => refetch()}>
            {t("settings.retry")}
          </Button>
        ) : (
          <Link href="/onboarding">
            <Button variant="secondary">{t("settings.finishSetup")}</Button>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">{t("settings.title")}</h1>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === tabId
                ? "border-brand text-brand"
                : "border-transparent text-foreground/60 hover:text-foreground"
            }`}
          >
            {t(TAB_LABELS[tabId])}
          </button>
        ))}
      </div>

      {tab === "Company" && <CompanyTab settings={settings} />}
      {tab === "Tax & Loyalty" && <TaxLoyaltyTab settings={settings} />}
      {tab === "Receipt" && <ReceiptTab settings={settings} />}
      {tab === "Features" && <FeaturesTab settings={settings} />}
      {tab === "Invoice & signature" && <InvoiceTab settings={settings} />}
      {tab === "Payments" && <PaymentsTab settings={settings} />}
      {tab === "Online stores" && <OnlineTab />}
      {tab === "E-mail reports" && <EmailTab />}
      {tab === "Branches" && <SyncTab />}
      {tab === "Reference Data" && <ReferenceDataTab />}
      {tab === "Integrations" && <IntegrationsTab />}
      {tab === "Password" && <PasswordTab />}
      {tab === "Staff" && <UsersPanel />}
      {tab === "Updates" && <UpdatesTab />}
    </div>
  );
}

function CompanyTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const { data: currencies } = useCurrencies();
  const { show } = useToast();
  // Initialised once from the loaded settings (the parent only renders this
  // tab after settings load, and remounts it on tab switch).
  const [form, setForm] = useState(settings);
  const [lookingUp, setLookingUp] = useState(false);
  const currencyOptions = Object.entries(currencies ?? {}).map(([value, c]) => ({
    value,
    label: `${c.symbol} ${c.label} (${value})`,
  }));
  const set = (k: keyof ShopSettings, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const { t } = useTranslation();
  // Only works once PIN codes have been imported on the Reference Data tab
  // — no PIN database ships with the app (see README).
  async function lookupPincode() {
    const pin = (form.pincode ?? "").trim();
    if (!pin) return;
    setLookingUp(true);
    try {
      const record = await api.get<PinCodeRecord>(`/masters/pincodes/${encodeURIComponent(pin)}`);
      setForm((f) => ({ ...f, city: record.district || f.city, state: record.state || f.state }));
      show(
        t("settings.company.pincodeFound", {
          area: record.area || record.district || "",
          state: record.state || "",
        }),
        "success",
      );
    } catch (err) {
      show(
        err instanceof ApiError ? err.message : t("settings.company.pincodeNotFound"),
        "info",
      );
    } finally {
      setLookingUp(false);
    }
  }

  return (
    <Card className="max-w-2xl p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            shopName: form.shopName,
            legalName: form.legalName || "",
            address1: form.address1,
            address2: form.address2 || "",
            pincode: form.pincode || "",
            city: form.city || "",
            state: form.state || "",
            phone: form.phone || "",
            email: form.email || "",
            currencyCode: form.currencyCode,
            lowStockAlert: form.lowStockAlert,
            allowNegativeStock: form.allowNegativeStock,
          });
        }}
        className="flex flex-col gap-4"
      >
        <Field label={t("settings.company.shopName")} value={form.shopName} onChange={(e) => set("shopName", e.target.value)} />
        <Field label={t("settings.company.legalName")} value={form.legalName ?? ""} onChange={(e) => set("legalName", e.target.value)} />
        <Field label={t("settings.company.address1")} value={form.address1} onChange={(e) => set("address1", e.target.value)} />
        <Field label={t("settings.company.address2")} value={form.address2 ?? ""} onChange={(e) => set("address2", e.target.value)} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field
              label={t("settings.company.pincode")}
              value={form.pincode ?? ""}
              onChange={(e) => set("pincode", e.target.value)}
              placeholder={t("settings.company.pincodePlaceholder")}
            />
          </div>
          <Button type="button" variant="secondary" onClick={lookupPincode} disabled={lookingUp} aria-label={t("settings.company.lookupPincode")}>
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("settings.company.city")} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          <Field label={t("settings.company.state")} value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("settings.company.phone")} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Field label={t("settings.company.email")} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label={t("settings.company.currency")}
            options={currencyOptions}
            value={form.currencyCode}
            onChange={(e) => set("currencyCode", e.target.value)}
          />
          <Field
            label={t("settings.company.lowStockAlert")}
            type="number"
            min={0}
            value={form.lowStockAlert}
            onChange={(e) => set("lowStockAlert", Number(e.target.value))}
          />
        </div>
        <Toggle
          label={t("settings.company.allowNegativeStock")}
          description={t("settings.company.allowNegativeStockDesc")}
          checked={form.allowNegativeStock}
          onChange={(v) => setForm((f) => ({ ...f, allowNegativeStock: v }))}
        />
        <Button type="submit" className="self-start">{t("settings.company.save")}</Button>
      </form>
    </Card>
  );
}

function TaxLoyaltyTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const [form, setForm] = useState(settings);
  const { t } = useTranslation();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-foreground">{t("settings.tax.title")}</h2>
        <div className="flex flex-col gap-4">
          <Toggle
            label={t("settings.tax.enableGst")}
            description={t("settings.tax.enableGstDesc")}
            checked={form.gstEnabled}
            onChange={(v) => setForm((f) => ({ ...f, gstEnabled: v }))}
          />
          {form.gstEnabled && (
            <>
              <Toggle
                label={t("settings.tax.showGstBreakdown")}
                checked={form.showGst}
                onChange={(v) => setForm((f) => ({ ...f, showGst: v }))}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Field
                    label={t("settings.tax.gstin")}
                    value={form.gstNumber ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value.toUpperCase() }))}
                  />
                  {form.gstNumber && (
                    <p className={`mt-1 text-xs ${isValidGstinFormat(form.gstNumber) ? "text-success" : "text-warning"}`}>
                      {isValidGstinFormat(form.gstNumber)
                        ? t("settings.tax.gstinValid", {
                            state: gstStateFromGstin(form.gstNumber) ?? t("settings.tax.unknownState"),
                          })
                        : t("settings.tax.gstinInvalid")}
                    </p>
                  )}
                </div>
                <Field
                  label={t("settings.tax.defaultGstRate")}
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.defaultTaxRate}
                  onChange={(e) => setForm((f) => ({ ...f, defaultTaxRate: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Field
                  label={t("settings.tax.pan")}
                  value={form.panNumber ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
                />
                {form.panNumber && (
                  <p className={`mt-1 text-xs ${isValidPanFormat(form.panNumber) ? "text-success" : "text-warning"}`}>
                    {isValidPanFormat(form.panNumber) ? t("settings.tax.panValid") : t("settings.tax.panInvalid")}
                  </p>
                )}
              </div>
            </>
          )}
          <Button
            className="self-start"
            onClick={() =>
              save({
                gstEnabled: form.gstEnabled,
                showGst: form.showGst,
                gstNumber: form.gstNumber || "",
                panNumber: form.panNumber || "",
                defaultTaxRate: form.defaultTaxRate,
              })
            }
          >
            {t("settings.tax.save")}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-foreground">{t("settings.loyalty.title")}</h2>
        <div className="flex flex-col gap-4">
          <Toggle
            label={t("settings.loyalty.enable")}
            description={t("settings.loyalty.enableDesc")}
            checked={form.loyaltyEnabled}
            onChange={(v) => setForm((f) => ({ ...f, loyaltyEnabled: v }))}
          />
          {form.loyaltyEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <Field
                label={t("settings.loyalty.pointsPerUnit")}
                type="number"
                min={0}
                step="0.01"
                value={form.pointsPerUnit}
                onChange={(e) => setForm((f) => ({ ...f, pointsPerUnit: Number(e.target.value) }))}
              />
              <Field
                label={t("settings.loyalty.pointValue")}
                type="number"
                min={0}
                step="0.01"
                value={form.pointValue}
                onChange={(e) => setForm((f) => ({ ...f, pointValue: Number(e.target.value) }))}
              />
            </div>
          )}
          <Button
            className="self-start"
            onClick={() =>
              save({
                loyaltyEnabled: form.loyaltyEnabled,
                pointsPerUnit: form.pointsPerUnit,
                pointValue: form.pointValue,
              })
            }
          >
            {t("settings.loyalty.save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

type PrinterDiag = {
  lpDevices: string[];
  libusbPrinter: { id: string } | null;
  canPrint: boolean;
  notes: string[];
};

function ReceiptTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const { show } = useToast();
  const { t } = useTranslation();
  const [header, setHeader] = useState(settings.receiptHeader ?? "");
  const [footer, setFooter] = useState(settings.receiptFooter ?? "");
  const [autoPrint, setAutoPrint] = useState(settings.autoPrintReceipt);
  const [autoPrintMethod, setAutoPrintMethod] = useState(settings.autoPrintMethod ?? "browser");
  const [usbWidth, setUsbWidth] = useState(String(settings.usbPrinterWidth));
  const [diag, setDiag] = useState<PrinterDiag | null>(null);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);

  async function checkPrinter() {
    setChecking(true);
    try {
      setDiag(await api.get<PrinterDiag>("/print/diagnostics"));
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.receipt.checkFailed"), "error");
    } finally {
      setChecking(false);
    }
  }

  async function testPrint() {
    setTesting(true);
    try {
      await api.post("/print/test");
      show(t("settings.receipt.testSent"), "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.receipt.testFailed"), "error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="max-w-2xl p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            receiptHeader: header,
            receiptFooter: footer,
            autoPrintReceipt: autoPrint,
            autoPrintMethod,
            usbPrinterWidth: Number(usbWidth),
          });
        }}
        className="flex flex-col gap-4"
      >
        <Toggle
          label={t("settings.receipt.autoPrint")}
          description={t("settings.receipt.autoPrintDesc")}
          checked={autoPrint}
          onChange={setAutoPrint}
        />
        {autoPrint && (
          <Select
            label={t("settings.receipt.autoPrintUsing")}
            value={autoPrintMethod}
            onChange={(e) => setAutoPrintMethod(e.target.value as "browser" | "usb")}
            options={[
              { value: "browser", label: t("settings.receipt.browserPrint") },
              { value: "usb", label: t("settings.receipt.usbPrint") },
            ]}
          />
        )}
        {autoPrint && autoPrintMethod === "usb" && (
          <p className="-mt-2 text-xs text-foreground/60">{t("settings.receipt.usbPrintDesc")}</p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rh" className="text-sm font-medium text-foreground">
            {t("settings.receipt.headerLabel")}
          </label>
          <textarea
            id="rh"
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            rows={2}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rf" className="text-sm font-medium text-foreground">
            {t("settings.receipt.footerLabel")}
          </label>
          <textarea
            id="rf"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            rows={2}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <Select
          label={t("settings.receipt.usbWidth")}
          value={usbWidth}
          onChange={(e) => setUsbWidth(e.target.value)}
          options={[
            { value: "80", label: t("settings.receipt.width80") },
            { value: "58", label: t("settings.receipt.width58") },
          ]}
        />
        <Button type="submit" className="self-start">{t("settings.receipt.save")}</Button>
      </form>

      {/* USB printer check — one click to see what the backend detects and to
          send a physical test slip, so a shop can confirm the printer works
          without ringing up a real sale. */}
      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-foreground">{t("settings.receipt.usbCheck")}</h3>
        <p className="mt-1 text-xs text-foreground/60">{t("settings.receipt.usbCheckDesc")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={checkPrinter} disabled={checking}>
            {checking ? t("settings.receipt.checking") : t("settings.receipt.checkPrinter")}
          </Button>
          <Button type="button" variant="secondary" onClick={testPrint} disabled={testing}>
            {testing ? t("settings.receipt.printing") : t("settings.receipt.printTest")}
          </Button>
        </div>
        {diag && (
          <div
            className={`mt-3 rounded-lg border p-3 text-xs ${
              diag.canPrint ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            <p className="font-semibold">
              {diag.canPrint ? t("settings.receipt.printerDetected") : t("settings.receipt.noPrinter")}
            </p>
            <ul className="mt-1.5 space-y-0.5 text-foreground/70">
              <li>
                {t("settings.receipt.kernelNodes", {
                  nodes: diag.lpDevices.length > 0 ? diag.lpDevices.join(", ") : t("settings.receipt.nodesNone"),
                })}
              </li>
              <li>
                {t("settings.receipt.usbDevice", {
                  device: diag.libusbPrinter ? diag.libusbPrinter.id : t("settings.receipt.deviceNone"),
                })}
              </li>
              {diag.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function PasswordTab() {
  const { show } = useToast();
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      show(t("settings.password.changed"), "success");
      setCurrent("");
      setNext("");
    } catch (err) {
      show(err instanceof ApiError ? err.message : t("settings.password.changeFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-md p-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={t("settings.password.current")}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label={t("settings.password.new")}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button type="submit" disabled={busy} className="self-start">{t("settings.password.change")}</Button>
      </form>
    </Card>
  );
}
