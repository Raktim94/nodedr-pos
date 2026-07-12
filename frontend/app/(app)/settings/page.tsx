"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { useCurrencies, useShopSettings, useUpdateSettings } from "@/hooks/useShopSettings";
import { api, ApiError } from "@/lib/api";
import { gstStateFromGstin, isValidGstinFormat, isValidPanFormat } from "@/lib/masters";
import type { PinCodeRecord } from "@/hooks/useMasters";
import type { ShopSettings } from "@/lib/types";
import { UsersPanel } from "./UsersPanel";
import { ReferenceDataTab } from "./ReferenceDataTab";

const TABS = ["Company", "Tax & Loyalty", "Receipt", "Reference Data", "Password", "Staff"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const { data: settings, isLoading } = useShopSettings();
  const [tab, setTab] = useState<Tab>("Company");

  if (isLoading || !settings) {
    return <p className="text-sm text-foreground/50">Loading settings…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-brand text-brand"
                : "border-transparent text-foreground/60 hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Company" && <CompanyTab settings={settings} />}
      {tab === "Tax & Loyalty" && <TaxLoyaltyTab settings={settings} />}
      {tab === "Receipt" && <ReceiptTab settings={settings} />}
      {tab === "Reference Data" && <ReferenceDataTab />}
      {tab === "Password" && <PasswordTab />}
      {tab === "Staff" && <UsersPanel />}
    </div>
  );
}

function useSaver() {
  const update = useUpdateSettings();
  const { show } = useToast();
  return async (patch: Partial<ShopSettings>) => {
    try {
      await update.mutateAsync(patch);
      show("Settings saved", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not save settings", "error");
    }
  };
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

  // Only works once PIN codes have been imported on the Reference Data tab
  // — no PIN database ships with the app (see README).
  async function lookupPincode() {
    const pin = (form.pincode ?? "").trim();
    if (!pin) return;
    setLookingUp(true);
    try {
      const record = await api.get<PinCodeRecord>(`/masters/pincodes/${encodeURIComponent(pin)}`);
      setForm((f) => ({ ...f, city: record.district || f.city, state: record.state || f.state }));
      show(`${record.area || record.district}, ${record.state}`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "PIN code not found — import PIN codes in Reference Data first", "info");
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
        <Field label="Shop name" value={form.shopName} onChange={(e) => set("shopName", e.target.value)} />
        <Field label="Legal name" value={form.legalName ?? ""} onChange={(e) => set("legalName", e.target.value)} />
        <Field label="Address line 1" value={form.address1} onChange={(e) => set("address1", e.target.value)} />
        <Field label="Address line 2" value={form.address2 ?? ""} onChange={(e) => set("address2", e.target.value)} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field
              label="PIN code"
              value={form.pincode ?? ""}
              onChange={(e) => set("pincode", e.target.value)}
              placeholder="Auto-fills city/state below, if imported"
            />
          </div>
          <Button type="button" variant="secondary" onClick={lookupPincode} disabled={lookingUp} aria-label="Look up PIN code">
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          <Field label="State" value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          <Field label="Email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Currency"
            options={currencyOptions}
            value={form.currencyCode}
            onChange={(e) => set("currencyCode", e.target.value)}
          />
          <Field
            label="Low stock alert"
            type="number"
            min={0}
            value={form.lowStockAlert}
            onChange={(e) => set("lowStockAlert", Number(e.target.value))}
          />
        </div>
        <Toggle
          label="Allow selling below zero stock"
          description="Checkout won't be blocked when a scanned item's stock is already at 0 or lower than the quantity sold — useful if you sell faster than you update counts and reconcile later"
          checked={form.allowNegativeStock}
          onChange={(v) => setForm((f) => ({ ...f, allowNegativeStock: v }))}
        />
        <Button type="submit" className="self-start">Save company details</Button>
      </form>
    </Card>
  );
}

function TaxLoyaltyTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const [form, setForm] = useState(settings);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-foreground">GST / Tax</h2>
        <div className="flex flex-col gap-4">
          <Toggle
            label="Enable GST"
            description="Apply per-product GST and show tax on receipts"
            checked={form.gstEnabled}
            onChange={(v) => setForm((f) => ({ ...f, gstEnabled: v }))}
          />
          {form.gstEnabled && (
            <>
              <Toggle
                label="Show GST breakdown on receipt"
                checked={form.showGst}
                onChange={(v) => setForm((f) => ({ ...f, showGst: v }))}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Field
                    label="GSTIN"
                    value={form.gstNumber ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value.toUpperCase() }))}
                  />
                  {form.gstNumber && (
                    <p className={`mt-1 text-xs ${isValidGstinFormat(form.gstNumber) ? "text-success" : "text-warning"}`}>
                      {isValidGstinFormat(form.gstNumber)
                        ? `Looks valid · ${gstStateFromGstin(form.gstNumber) ?? "unknown state code"}`
                        : "Doesn't match the standard 15-character GSTIN format — double-check it"}
                    </p>
                  )}
                </div>
                <Field
                  label="Default GST rate %"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.defaultTaxRate}
                  onChange={(e) => setForm((f) => ({ ...f, defaultTaxRate: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Field
                  label="PAN"
                  value={form.panNumber ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
                />
                {form.panNumber && (
                  <p className={`mt-1 text-xs ${isValidPanFormat(form.panNumber) ? "text-success" : "text-warning"}`}>
                    {isValidPanFormat(form.panNumber) ? "Looks valid" : "Doesn't match the standard 10-character PAN format — double-check it"}
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
            Save tax settings
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-foreground">Loyalty program</h2>
        <div className="flex flex-col gap-4">
          <Toggle
            label="Enable loyalty"
            description="Customers earn points, redeemable as discounts"
            checked={form.loyaltyEnabled}
            onChange={(v) => setForm((f) => ({ ...f, loyaltyEnabled: v }))}
          />
          {form.loyaltyEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Points earned per unit spent"
                type="number"
                min={0}
                step="0.01"
                value={form.pointsPerUnit}
                onChange={(e) => setForm((f) => ({ ...f, pointsPerUnit: Number(e.target.value) }))}
              />
              <Field
                label="Value of 1 point (in currency)"
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
            Save loyalty settings
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ReceiptTab({ settings }: { settings: ShopSettings }) {
  const save = useSaver();
  const [header, setHeader] = useState(settings.receiptHeader ?? "");
  const [footer, setFooter] = useState(settings.receiptFooter ?? "");
  const [autoPrint, setAutoPrint] = useState(settings.autoPrintReceipt);

  return (
    <Card className="max-w-2xl p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ receiptHeader: header, receiptFooter: footer, autoPrintReceipt: autoPrint });
        }}
        className="flex flex-col gap-4"
      >
        <Toggle
          label="Print automatically after every sale"
          description="Skips the extra click on the checkout page — the receipt opens and sends to your printer the moment a sale completes"
          checked={autoPrint}
          onChange={setAutoPrint}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rh" className="text-sm font-medium text-foreground">
            Receipt header (printed above the shop name)
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
            Receipt footer (thank-you message)
          </label>
          <textarea
            id="rf"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            rows={2}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <Button type="submit" className="self-start">Save receipt settings</Button>
      </form>
    </Card>
  );
}

function PasswordTab() {
  const { show } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      show("Password changed", "success");
      setCurrent("");
      setNext("");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not change password", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-md p-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password (min 8 chars)"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button type="submit" disabled={busy} className="self-start">Change password</Button>
      </form>
    </Card>
  );
}
