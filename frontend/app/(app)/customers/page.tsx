"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Plus, Search, Star, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SettleDueModal } from "@/components/SettleDueModal";
import { useToast } from "@/components/Toast";
import { useCustomers, useCreateCustomer, useSettleDue } from "@/hooks/useCustomers";
import { useShopSettings } from "@/hooks/useShopSettings";
import { formatMoney } from "@/lib/format";
import { ApiError } from "@/lib/api";
import type { Customer } from "@/lib/types";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(3, "Phone is required"),
  email: z.string().trim().optional(),
});
type Form = z.infer<typeof schema>;

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [settleTarget, setSettleTarget] = useState<Customer | null>(null);
  const { data: customers, isLoading } = useCustomers(search);
  const { data: shop } = useShopSettings();
  const createCustomer = useCreateCustomer();
  const settleDue = useSettleDue();
  const { show } = useToast();
  const sym = shop?.currencySymbol || "Rs.";

  async function clearDue(c: Customer) {
    if (!window.confirm(`Clear ${formatMoney(c.totalDue, sym)} due for ${c.name}? This marks it fully paid.`)) return;
    try {
      await settleDue.mutateAsync({ id: c.id, amount: c.totalDue });
      show(`Due cleared for ${c.name}`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not clear due", "error");
    }
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  async function onCreate(values: Form) {
    try {
      await createCustomer.mutateAsync(values);
      show("Customer added", "success");
      reset();
      setShowForm(false);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Could not add customer", "error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Customers</h1>
          <p className="text-sm text-foreground/60">
            {shop?.loyaltyEnabled ? "Loyalty members and their points." : "Your customer directory."}
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add customer
        </Button>
      </div>

      {showForm && (
        <Card className="p-6">
          <form onSubmit={handleSubmit(onCreate)} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Name" error={errors.name?.message} {...register("name")} />
            <Field label="Phone" error={errors.phone?.message} {...register("phone")} />
            <Field label="Email (optional)" {...register("email")} />
            <div className="flex items-end gap-2 sm:col-span-3">
              <Button type="submit" disabled={isSubmitting}>Save customer</Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" aria-hidden="true" /> Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <Search className="h-4 w-4 text-foreground/40" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            aria-label="Search customers"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40"
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-foreground/50">Loading…</p>
        ) : !customers || customers.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground/50">No customers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-foreground/50">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4 text-right">Visits</th>
                  <th className="py-2 pr-4 text-right">Total spent</th>
                  <th className="py-2 pr-4 text-right">Due</th>
                  <th className="py-2 pr-4 text-right">Store credit</th>
                  {shop?.loyaltyEnabled && <th className="py-2 text-right">Points</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 pr-4 font-medium text-foreground">{c.name}</td>
                    <td className="py-2.5 pr-4 text-foreground/70">{c.phone}</td>
                    <td className="py-2.5 pr-4 text-right text-foreground/70">{c.visits}</td>
                    <td className="py-2.5 pr-4 text-right text-foreground/70">{formatMoney(c.totalSpent, sym)}</td>
                    <td className="py-2.5 pr-4 text-right">
                      {c.totalDue >= 0.01 ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSettleTarget(c)}
                            className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/20"
                            title="Record a payment"
                          >
                            {formatMoney(c.totalDue, sym)}
                          </button>
                          <button
                            type="button"
                            onClick={() => clearDue(c)}
                            aria-label={`Clear due for ${c.name}`}
                            title="Clear due (mark fully paid)"
                            className="text-foreground/40 hover:text-success"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-foreground/30">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      {c.creditBalance >= 0.01 ? (
                        <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                          {formatMoney(c.creditBalance, sym)}
                        </span>
                      ) : (
                        <span className="text-foreground/30">—</span>
                      )}
                    </td>
                    {shop?.loyaltyEnabled && (
                      <td className="py-2.5 text-right">
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                          <Star className="h-3 w-3" aria-hidden="true" />
                          {c.loyaltyPoints}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {settleTarget && <SettleDueModal customer={settleTarget} sym={sym} onClose={() => setSettleTarget(null)} />}
    </div>
  );
}
