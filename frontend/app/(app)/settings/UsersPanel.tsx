"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { useUsers, useCreateUser, useUpdateUser } from "@/hooks/useAuth";
import { useMe } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(["admin", "cashier"]),
});
type CreateForm = z.infer<typeof createSchema>;

export function UsersPanel() {
  const { data: users } = useUsers();
  const { data: me } = useMe();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { show } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { role: "cashier" } });

  const [showForm, setShowForm] = useState(false);

  async function onCreate(values: CreateForm) {
    try {
      await createUser.mutateAsync(values);
      show("Staff account created", "success");
      reset({ role: "cashier" });
      setShowForm(false);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not create user", "error");
    }
  }

  async function toggleActive(id: number, active: boolean) {
    try {
      await updateUser.mutateAsync({ id, data: { active } });
      show(active ? "User enabled" : "User disabled", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not update user", "error");
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Staff accounts</h2>
        <Button onClick={() => setShowForm((s) => !s)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add staff
        </Button>
      </div>

      {showForm && (
        <Card className="p-6">
          <form onSubmit={handleSubmit(onCreate)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name?.message} {...register("name")} />
            <Field label="Email" type="email" error={errors.email?.message} {...register("email")} />
            <Field label="Password" type="password" error={errors.password?.message} {...register("password")} />
            <Select
              label="Role"
              options={[
                { value: "cashier", label: "Cashier" },
                { value: "admin", label: "Admin" },
              ]}
              {...register("role")}
            />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={isSubmitting}>Create account</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-foreground/50">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-foreground/40">(you)</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground/70">{u.email}</td>
                  <td className="py-2.5 pr-4 capitalize text-foreground/70">{u.role}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={
                        u.active
                          ? "rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
                          : "rounded-full bg-foreground/10 px-2.5 py-1 text-xs font-semibold text-foreground/50"
                      }
                    >
                      {u.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    {u.id !== me?.id && (
                      <button
                        onClick={() => toggleActive(u.id, !u.active)}
                        className="text-sm font-medium text-brand hover:underline"
                      >
                        {u.active ? "Disable" : "Enable"}
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
