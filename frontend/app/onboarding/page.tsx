"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BrandFooter } from "@/components/BrandFooter";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useTranslation } from "@/components/I18nProvider";
import { useCurrencies } from "@/hooks/useShopSettings";
import { api, ApiError } from "@/lib/api";

type AccountForm = { name: string; email: string; password: string };
type ShopForm = {
  shopName: string;
  address1: string;
  address2?: string;
  city?: string;
  state?: string;
  phone?: string;
  currencyCode: string;
  lowStockAlert: number;
  gstNumber?: string;
  defaultTaxRate: number;
};

const STEPS = ["onboarding.step.account", "onboarding.step.company", "onboarding.step.done"] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: currencies } = useCurrencies();
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);

  const accountSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("onboarding.errNameRequired")),
        email: z.string().trim().toLowerCase().email(t("onboarding.errEmailInvalid")),
        password: z.string().min(8, t("onboarding.errPasswordLength")),
      }),
    [t]
  );
  const shopSchema = useMemo(
    () =>
      z.object({
        shopName: z.string().trim().min(1, t("onboarding.errShopNameRequired")),
        address1: z.string().trim().min(1, t("onboarding.errAddressRequired")),
        address2: z.string().trim().optional(),
        city: z.string().trim().optional(),
        state: z.string().trim().optional(),
        phone: z.string().trim().optional(),
        currencyCode: z.string().min(1, t("onboarding.errCurrencyRequired")),
        lowStockAlert: z.number().int().min(0),
        gstNumber: z.string().trim().optional(),
        defaultTaxRate: z.number().min(0).max(100),
      }),
    [t]
  );

  const currencyOptions = Object.entries(currencies ?? {}).map(([value, c]) => ({
    value,
    label: `${c.symbol} ${c.label} (${value})`,
  }));

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
      setServerError(err instanceof ApiError ? err.message : t("onboarding.errAccount"));
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
      setServerError(err instanceof ApiError ? err.message : t("onboarding.errSettings"));
    }
  }

  return (
    <main className="relative flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-lg p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image src="/logo.png" alt="nodedr-pos" width={64} height={64} className="h-16 w-16 rounded-full" priority />
          <h1 className="text-xl font-semibold text-foreground">{t("onboarding.welcome")}</h1>
          <p className="text-sm text-foreground/60">{t("onboarding.subtitle")}</p>
        </div>

        <ol className="mb-8 flex items-center justify-center gap-2" aria-label={t("onboarding.progress")}>
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
            <h2 className="text-sm font-semibold text-foreground/70">{t("onboarding.step1")}</h2>
            <Field label={t("onboarding.yourName")} error={accountForm.formState.errors.name?.message} {...accountForm.register("name")} />
            <Field
              label={t("onboarding.email")}
              type="email"
              autoComplete="email"
              error={accountForm.formState.errors.email?.message}
              {...accountForm.register("email")}
            />
            <Field
              label={t("onboarding.password")}
              type="password"
              autoComplete="new-password"
              error={accountForm.formState.errors.password?.message}
              {...accountForm.register("password")}
            />
            <p className="-mt-2 text-xs text-foreground/50">{t("onboarding.noForgot")}</p>
            {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
            <Button type="submit" disabled={accountForm.formState.isSubmitting} className="mt-2 w-full">
              {t("onboarding.continue")}
            </Button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={shopForm.handleSubmit(onShopSubmit)} noValidate className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground/70">{t("onboarding.step2")}</h2>
            <Field label={t("onboarding.shopName")} error={shopForm.formState.errors.shopName?.message} {...shopForm.register("shopName")} />
            <Field label={t("onboarding.address1")} error={shopForm.formState.errors.address1?.message} {...shopForm.register("address1")} />
            <Field label={t("onboarding.address2")} {...shopForm.register("address2")} />
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("onboarding.city")} {...shopForm.register("city")} />
              <Field label={t("onboarding.state")} {...shopForm.register("state")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("onboarding.phone")} {...shopForm.register("phone")} />
              <Select label={t("onboarding.currency")} options={currencyOptions} {...shopForm.register("currencyCode")} />
            </div>
            <Field
              label={t("onboarding.lowStockThreshold")}
              type="number"
              min={0}
              error={shopForm.formState.errors.lowStockAlert?.message}
              {...shopForm.register("lowStockAlert", { valueAsNumber: true })}
            />

            <div className="rounded-lg border border-border p-4">
              <Toggle
                label={t("onboarding.enableGst")}
                description={t("onboarding.enableGstDesc")}
                checked={gstEnabled}
                onChange={setGstEnabled}
              />
              {gstEnabled && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Field label={t("onboarding.gstin")} {...shopForm.register("gstNumber")} />
                  <Field
                    label={t("onboarding.defaultGstRate")}
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
                label={t("onboarding.enableLoyalty")}
                description={t("onboarding.enableLoyaltyDesc")}
                checked={loyaltyEnabled}
                onChange={setLoyaltyEnabled}
              />
              {loyaltyEnabled && (
                <p className="mt-3 text-xs text-foreground/50">{t("onboarding.loyaltyHint")}</p>
              )}
            </div>

            {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => setStep(0)} className="flex-1">
                {t("onboarding.back")}
              </Button>
              <Button type="submit" disabled={shopForm.formState.isSubmitting} className="flex-1">
                {t("onboarding.continue")}
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <Check className="h-7 w-7 text-success" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">{t("onboarding.allSet")}</h2>
            <p className="text-sm text-foreground/60">{t("onboarding.readyDesc")}</p>
            <Button className="mt-2 w-full" onClick={() => router.replace("/dashboard")}>
              {t("onboarding.goDashboard")}
            </Button>
          </div>
        )}
      </Card>
      <BrandFooter />
    </main>
  );
}
