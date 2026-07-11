"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Store, Check } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api, ApiError } from "@/lib/api";

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});
type AccountForm = z.infer<typeof accountSchema>;

const shopSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required"),
  address1: z.string().trim().min(1, "Address is required"),
  address2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  currencyCode: z.enum(["INR", "USD", "EUR", "GBP"]),
  lowStockAlert: z.number().int().min(0),
  gstNumber: z.string().trim().optional(),
  defaultTaxRate: z.number().min(0).max(100),
});
type ShopForm = z.infer<typeof shopSchema>;

const STEPS = ["Account", "Company", "Done"] as const;

const CURRENCY_OPTIONS = [
  { value: "INR", label: "₹ Indian Rupee (INR)" },
  { value: "USD", label: "$ US Dollar (USD)" },
  { value: "EUR", label: "€ Euro (EUR)" },
  { value: "GBP", label: "£ British Pound (GBP)" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);

  const accountForm = useForm<AccountForm>({ resolver: zodResolver(accountSchema) });
  const shopForm = useForm<ShopForm>({
    resolver: zodResolver(shopSchema),
    defaultValues: { currencyCode: "INR", lowStockAlert: 5, defaultTaxRate: 0 },
  });

  async function onAccountSubmit(values: AccountForm) {
    setServerError(null);
    try {
      await api.post("/auth/register", values);
      setStep(1);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not create the admin account");
    }
  }

  async function onShopSubmit(values: ShopForm) {
    setServerError(null);
    try {
      await api.post("/settings", {
        ...values,
        gstEnabled,
        loyaltyEnabled,
        // sensible loyalty defaults if enabled: 1 pt per unit, 1 pt = 0.1 unit
        pointsPerUnit: loyaltyEnabled ? 1 : 0,
        pointValue: loyaltyEnabled ? 0.1 : 0,
      });
      setStep(2);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not save company settings");
    }
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg p-8">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Store className="h-9 w-9 text-brand" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground">Welcome to nodedr-pos</h1>
          <p className="text-sm text-foreground/60">Let&apos;s set up your shop.</p>
        </div>

        <ol className="mb-8 flex items-center justify-center gap-2" aria-label="Onboarding progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step
                    ? "bg-success text-white"
                    : i === step
                      ? "bg-brand text-brand-foreground"
                      : "bg-surface-muted text-foreground/50"
                }`}
                aria-current={i === step ? "step" : undefined}
              >
                {i < step ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <form onSubmit={accountForm.handleSubmit(onAccountSubmit)} noValidate className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground/70">Step 1 — Admin account</h2>
            <Field label="Your name" error={accountForm.formState.errors.name?.message} {...accountForm.register("name")} />
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              error={accountForm.formState.errors.email?.message}
              {...accountForm.register("email")}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="new-password"
              error={accountForm.formState.errors.password?.message}
              {...accountForm.register("password")}
            />
            {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
            <Button type="submit" disabled={accountForm.formState.isSubmitting} className="mt-2 w-full">
              Continue
            </Button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={shopForm.handleSubmit(onShopSubmit)} noValidate className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground/70">Step 2 — Company details</h2>
            <Field label="Shop name" error={shopForm.formState.errors.shopName?.message} {...shopForm.register("shopName")} />
            <Field label="Address line 1" error={shopForm.formState.errors.address1?.message} {...shopForm.register("address1")} />
            <Field label="Address line 2" {...shopForm.register("address2")} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="City" {...shopForm.register("city")} />
              <Field label="State" {...shopForm.register("state")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" {...shopForm.register("phone")} />
              <Select label="Currency" options={CURRENCY_OPTIONS} {...shopForm.register("currencyCode")} />
            </div>
            <Field
              label="Low stock alert threshold"
              type="number"
              min={0}
              error={shopForm.formState.errors.lowStockAlert?.message}
              {...shopForm.register("lowStockAlert", { valueAsNumber: true })}
            />

            <div className="rounded-lg border border-border p-4">
              <Toggle
                label="Enable GST / tax"
                description="Charge per-product GST and show a tax breakdown on bills"
                checked={gstEnabled}
                onChange={setGstEnabled}
              />
              {gstEnabled && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label="GSTIN (optional)" {...shopForm.register("gstNumber")} />
                  <Field
                    label="Default GST rate %"
                    type="number"
                    min={0}
                    step="0.01"
                    {...shopForm.register("defaultTaxRate", { valueAsNumber: true })}
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border p-4">
              <Toggle
                label="Enable loyalty program"
                description="Customers earn points on purchases, redeemable as discounts"
                checked={loyaltyEnabled}
                onChange={setLoyaltyEnabled}
              />
              {loyaltyEnabled && (
                <p className="mt-3 text-xs text-foreground/50">
                  Starts at 1 point per unit spent, 1 point = 0.1 in currency. You can fine-tune this later in Settings.
                </p>
              )}
            </div>

            {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => setStep(0)} className="flex-1">
                Back
              </Button>
              <Button type="submit" disabled={shopForm.formState.isSubmitting} className="flex-1">
                Continue
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <Check className="h-7 w-7 text-success" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">You&apos;re all set!</h2>
            <p className="text-sm text-foreground/60">Your shop is configured and ready to start selling.</p>
            <Button className="mt-2 w-full" onClick={() => router.replace("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
