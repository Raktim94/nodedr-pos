"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Store, Check } from "lucide-react";
import { Field } from "@/components/ui/Field";
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
  currency: z.string().trim().min(1, "Currency symbol is required"),
  lowStockAlert: z.number().int().min(0, "Must be 0 or more"),
});
type ShopForm = z.infer<typeof shopSchema>;

const STEPS = ["Account", "Shop", "Done"] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);

  const accountForm = useForm<AccountForm>({ resolver: zodResolver(accountSchema) });
  const shopForm = useForm<ShopForm>({
    resolver: zodResolver(shopSchema),
    defaultValues: { currency: "Rs.", lowStockAlert: 5 },
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
      await api.post("/settings", values);
      setStep(2);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not save shop settings");
    }
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md p-8">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Store className="h-9 w-9 text-brand" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-foreground">Welcome to nodedr-pos</h1>
          <p className="text-sm text-foreground/60">Let&apos;s get your shop set up.</p>
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
            <Field label="Admin name" error={accountForm.formState.errors.name?.message} {...accountForm.register("name")} />
            <Field
              label="Email"
              type="email"
              error={accountForm.formState.errors.email?.message}
              {...accountForm.register("email")}
            />
            <Field
              label="Password"
              type="password"
              error={accountForm.formState.errors.password?.message}
              {...accountForm.register("password")}
            />
            {serverError && (
              <p role="alert" className="text-sm text-danger">
                {serverError}
              </p>
            )}
            <Button type="submit" disabled={accountForm.formState.isSubmitting} className="mt-2 w-full">
              Continue
            </Button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={shopForm.handleSubmit(onShopSubmit)} noValidate className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground/70">Step 2 — Shop setup</h2>
            <Field label="Shop name" error={shopForm.formState.errors.shopName?.message} {...shopForm.register("shopName")} />
            <Field
              label="Shop address (line 1)"
              error={shopForm.formState.errors.address1?.message}
              {...shopForm.register("address1")}
            />
            <Field label="Shop address (line 2)" {...shopForm.register("address2")} />
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Currency symbol"
                error={shopForm.formState.errors.currency?.message}
                {...shopForm.register("currency")}
              />
              <Field
                label="Low stock alert"
                type="number"
                min={0}
                error={shopForm.formState.errors.lowStockAlert?.message}
                {...shopForm.register("lowStockAlert", { valueAsNumber: true })}
              />
            </div>
            {serverError && (
              <p role="alert" className="text-sm text-danger">
                {serverError}
              </p>
            )}
            <Button type="submit" disabled={shopForm.formState.isSubmitting} className="mt-2 w-full">
              Continue
            </Button>
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
