"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";
import { roleKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import { useUsers, useCreateUser, useUpdateUser } from "@/hooks/useAuth";
import { useMe } from "@/hooks/useAuth";

type CreateForm = {
  name: string;
  email: string;
  password: string;
  role: "admin" | "cashier";
};

const roleLabel = (t: (key: TranslationKey) => string, role: string) => {
  const key = roleKey(role);
  return key ? t(key) : role;
};

export function UsersPanel() {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { show } = useToast();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { t } = useTranslation();

  const createSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("settings.users.errNameRequired")),
        email: z.string().trim().toLowerCase().email(t("settings.users.errEmailInvalid")),
        password: z.string().min(8, t("settings.users.errPasswordLength")),
        role: z.enum(["admin", "cashier"]),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { role: "cashier" } });

  const [showForm, setShowForm] = useState(false);

  async function onCreate(values: CreateForm) {
    const result = await withPasswordConfirm(t("settings.users.confirmCreate"), (confirmPassword) =>
      createUser.mutateAsync({ ...values, confirmPassword })
    );
    if (result) {
      show(t("settings.users.created"), "success");
      reset({ role: "cashier" });
      setShowForm(false);
    }
  }

  async function toggleActive(id: number, active: boolean) {
    const result = await withPasswordConfirm(
      active ? t("settings.users.confirmEnable") : t("settings.users.confirmDisable"),
      (confirmPassword) => updateUser.mutateAsync({ id, data: { active, confirmPassword } }),
    );
    if (result) show(active ? t("settings.users.enabled") : t("settings.users.disabled"), "success");
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{t("settings.users.title")}</h2>
        <Button onClick={() => setShowForm((s) => !s)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {t("settings.users.addStaff")}
        </Button>
      </div>

      {showForm && (
        <Card className="p-6">
          <form onSubmit={handleSubmit(onCreate)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("settings.users.name")} error={errors.name?.message} {...register("name")} />
            <Field label={t("settings.users.email")} type="email" error={errors.email?.message} {...register("email")} />
            <Field label={t("settings.users.password")} type="password" error={errors.password?.message} {...register("password")} />
            <Select
              label={t("settings.users.role")}
              options={[
                { value: "cashier", label: t("settings.users.cashier") },
                { value: "admin", label: t("settings.users.admin") },
              ]}
              {...register("role")}
            />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={isSubmitting}>{t("settings.users.create")}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-foreground/50">
                <th className="py-2 pr-4">{t("settings.users.table.name")}</th>
                <th className="py-2 pr-4">{t("settings.users.table.email")}</th>
                <th className="py-2 pr-4">{t("settings.users.table.role")}</th>
                <th className="py-2 pr-4">{t("settings.users.table.status")}</th>
                <th className="py-2 text-right">{t("settings.users.table.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-foreground/40">{t("settings.users.you")}</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground/70">{u.email}</td>
                  <td className="py-2.5 pr-4 capitalize text-foreground/70">{roleLabel(t, u.role)}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={
                        u.active
                          ? "rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
                          : "rounded-full bg-foreground/10 px-2.5 py-1 text-xs font-semibold text-foreground/50"
                      }
                    >
                      {u.active ? t("settings.users.active") : t("settings.users.disabledStatus")}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    {u.id !== me?.id && (
                      <button
                        onClick={() => toggleActive(u.id, !u.active)}
                        className="text-sm font-medium text-brand hover:underline"
                      >
                        {u.active ? t("settings.users.disable") : t("settings.users.enable")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
