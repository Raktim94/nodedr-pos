"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge, EmptyState, PageHeader } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useCreateUser, useMe, useUpdateUser, useUsers } from "@/hooks/useAuth";
import { useTranslation } from "@/components/I18nProvider";
import { describeApiError } from "@/lib/api";
import { roleKey } from "@/lib/enumLabels";
import type { TranslationKey } from "@/lib/i18n";
import type { AuthUser, Permission, Role } from "@/lib/types";

const roleLabel = (t: (key: TranslationKey) => string, role: string) => {
  const key = roleKey(role);
  return key ? t(key) : role;
};

const PERMS: { key: Permission; label: TranslationKey; hint: TranslationKey | "" }[] = [
  { key: "discount", label: "team.perm.discount", hint: "team.perm.discountHint" },
  { key: "returns", label: "team.perm.returns", hint: "team.perm.returnsHint" },
  { key: "inventory", label: "team.perm.inventory", hint: "team.perm.inventoryHint" },
  { key: "customers", label: "team.perm.customers", hint: "" },
  { key: "orders", label: "team.perm.orders", hint: "team.perm.ordersHint" },
  { key: "purchasing", label: "team.perm.purchasing", hint: "team.perm.purchasingHint" },
  { key: "reports", label: "team.perm.reports", hint: "team.perm.reportsHint" },
];
const PASTELS = ["#e8f3ea", "#fdf0d5", "#e3eef9", "#f6e3ee", "#ece6f7", "#e0f3f0"];

export default function TeamPage() {
  const { data: users = [], isLoading } = useUsers();
  const { data: me } = useMe();
  const { t } = useTranslation();
  const [open, setOpen] = useState<AuthUser | "new" | null>(null);

  return (
    <div>
      <PageHeader title={t("team.title")} subtitle={t("team.subtitle")} actions={<Button onClick={() => setOpen("new")}><UserPlus className="h-4 w-4" aria-hidden="true" /> {t("team.addMember")}</Button>} />
      {isLoading && <p className="text-foreground-muted">{t("team.loading")}</p>}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {users.map((u, i) => (
          <li key={u.id} className="rise" style={{ "--i": i } as React.CSSProperties}>
            <button type="button" onClick={() => setOpen(u)} className="card-surface card-lift flex h-full w-full flex-col gap-3 p-5 text-left">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold text-[#0d3b28]" style={{ background: PASTELS[i % PASTELS.length] }} aria-hidden="true">{u.name.trim()[0]?.toUpperCase()}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{u.name}{u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-foreground-muted">{t("team.you")}</span>}</p>
                  <p className="truncate text-sm text-foreground-muted">{u.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={u.role === "admin" ? "brand" : u.role === "franchisor" ? "warn" : "neutral"}>{roleLabel(t, u.role)}</Badge>
                {!u.active && <Badge tone="bad">{t("team.badgeDisabled")}</Badge>}
                {u.role === "cashier" && u.permissions.length === 0 && <Badge>{t("team.badgeSellOnly")}</Badge>}
                {u.role === "cashier" && u.maxDiscountPercent != null && <Badge tone="warn">{t("team.badgeDiscount", { percent: u.maxDiscountPercent })}</Badge>}
              </div>
              <p className="mt-auto text-xs text-foreground-muted">{u.role === "admin" ? t("team.fullAccess") : u.role === "franchisor" ? t("team.franchisorAccess") : t(u.permissions.length === 1 ? "team.extraPermissionOne" : "team.extraPermissionMany", { count: u.permissions.length })}</p>
            </button>
          </li>
        ))}
      </ul>
      {!isLoading && users.length === 0 && <EmptyState title={t("team.empty")} />}
      {open && <MemberDrawer user={open === "new" ? null : open} isSelf={open !== "new" && open.id === me?.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MemberDrawer({ user, isSelf, onClose }: { user: AuthUser | null; isSelf: boolean; onClose: () => void }) {
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  const create = useCreateUser();
  const update = useUpdateUser();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "cashier");
  const [perms, setPerms] = useState<Permission[]>(user?.permissions ?? ["discount", "returns", "customers", "orders"]);
  const [cap, setCap] = useState(user?.maxDiscountPercent != null ? String(user.maxDiscountPercent) : "");
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const maxDiscountPercent = cap.trim() === "" ? null : Math.min(100, Math.max(0, Number(cap) || 0));
      const done = await withPasswordConfirm(user ? t("team.passwordPromptUpdate") : t("team.passwordPromptCreate"), async (confirmPassword) => {
        if (!user) return create.mutateAsync({ name, email, password, role, permissions: perms, maxDiscountPercent, confirmPassword });
        return update.mutateAsync({ id: user.id, data: { name, role, active, permissions: perms, maxDiscountPercent, ...(password ? { password } : {}), confirmPassword } });
      });
      if (done) {
        show(user ? t("team.saved") : t("team.added"), "success");
        onClose();
      }
    } catch (e) {
      show(describeApiError(e, t("team.saveFailed")), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={user ? user.name : t("team.modalAddTitle")} variant="drawer" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label={t("team.fieldName")} required value={name} onChange={(e) => setName(e.target.value)} />
        {!user && <Field label={t("team.fieldEmail")} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        <Field label={user ? t("team.fieldNewPassword") : t("team.fieldPassword")} type="password" minLength={8} required={!user} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t("team.roleLabel")}
          <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
            <option value="cashier">{t("team.roleCashier")}</option>
            <option value="admin">{t("team.roleAdmin")}</option>
            <option value="franchisor">{t("team.roleFranchisor")}</option>
          </select>
        </label>
        {role === "cashier" && (
          <fieldset className="flex flex-col gap-2.5 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{t("team.permissions")}</legend>
            {PERMS.map((p) => (
              <label key={p.key} className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={perms.includes(p.key)} onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p.key] : cur.filter((x) => x !== p.key)))} />
                <span><span className="font-medium">{t(p.label)}</span>{p.hint && <span className="block text-xs text-foreground-muted">{t(p.hint)}</span>}</span>
              </label>
            ))}
            <Field label={t("team.discountLimit")} type="number" min={0} max={100} step="0.5" disabled={!perms.includes("discount")} value={cap} onChange={(e) => setCap(e.target.value)} />
          </fieldset>
        )}
        {user && !isSelf && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t("team.accountActive")}</label>
        )}
        <Button type="submit" disabled={busy || !name.trim() || (!user && (!email || password.length < 8))}>{busy ? t("team.saving") : t("team.save")}</Button>
      </form>
    </Modal>
  );
}
