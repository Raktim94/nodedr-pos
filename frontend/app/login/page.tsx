"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BrandFooter } from "@/components/BrandFooter";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useTranslation } from "@/components/I18nProvider";
import { api, ApiError } from "@/lib/api";

type LoginForm = { email: string; password: string };

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().trim().toLowerCase().email(t("login.invalidEmail")),
        password: z.string().min(1, t("login.passwordRequired")),
      }),
    [t]
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginForm) {
    setServerError(null);
    try {
      await api.post("/auth/login", values);
      router.replace("/dashboard");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t("login.failed"));
    }
  }

  return (
    <main className="relative flex min-h-screen flex-1 flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/logo.png" alt="nodedr-pos" width={64} height={64} className="h-16 w-16 rounded-full" priority />
          <h1 className="text-xl font-semibold text-foreground">{t("login.title")}</h1>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <Field
            label={t("login.email")}
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <Field
            label={t("login.password")}
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register("password")}
          />
          {serverError && (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">
            {isSubmitting ? t("login.signingIn") : t("login.signIn")}
          </Button>
        </form>
      </Card>
      <BrandFooter />
    </main>
  );
}
