"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Plus, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";
import { useApiKeys, useCreateApiKey, useUpdateApiKey, useDeleteApiKey } from "@/hooks/useApiKeys";
import { describeApiError } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import type { ApiKey, ApiKeyWithSecrets } from "@/lib/types";

const SCOPE_INFO: { key: string; label: TranslationKey; hint: TranslationKey }[] = [
  { key: "products:read", label: "settings.integrations.scopeProductsRead", hint: "settings.integrations.scopeProductsReadHint" },
  { key: "stock:write", label: "settings.integrations.scopeStockWrite", hint: "settings.integrations.scopeStockWriteHint" },
  { key: "bills:write", label: "settings.integrations.scopeBillsWrite", hint: "settings.integrations.scopeBillsWriteHint" },
  { key: "bills:read", label: "settings.integrations.scopeBillsRead", hint: "settings.integrations.scopeBillsReadHint" },
  { key: "orders:write", label: "settings.integrations.scopeOrdersWrite", hint: "settings.integrations.scopeOrdersWriteHint" },
  { key: "warranty:read", label: "settings.integrations.scopeWarrantyRead", hint: "settings.integrations.scopeWarrantyReadHint" },
];

function ApiGuide() {
  const [origin, setOrigin] = useState("");
  const { t } = useTranslation();
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-foreground">{t("settings.integrations.guideTitle")}</h2>
      <p className="mt-1 text-sm text-foreground-muted">{t("settings.integrations.guideDesc")}</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-muted p-3 text-xs leading-relaxed">{`# take a bill from your store (idempotent on externalRef)
curl -X POST ${origin}/api/external/bills \
  -H "Authorization: Bearer nk_live_…" -H "Content-Type: application/json" \
  -d '{"externalRef":"order-1001","customer":{"name":"Asha","phone":"9999900000"},
       "items":[{"sku":"PHONE-1","quantity":1,"serials":["490154203237518"]}],
       "paymentMethod":"UPI"}'

# download the PDF bill      GET /api/external/bills/order-1001/pdf?layout=a4
# live stock (incremental)   GET /api/external/products?updatedSince=2026-01-01T00:00:00Z
# warranty from IMEI         GET /api/external/warranty/490154203237518`}</pre>
      <p className="mt-3 text-sm font-medium">MCP</p>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-muted p-3 text-xs leading-relaxed">{`# Remote (Streamable HTTP):  POST ${origin}/mcp   (Authorization: Bearer nk_live_…)
# Local desktop client (stdio), run on the POS machine:
{ "mcpServers": { "nodedr-pos": {
    "command": "node", "args": ["backend/src/mcp/stdio.js"],
    "env": { "NODEDR_API_KEY": "nk_live_…", "DATABASE_URL": "file:./data/pos.db" } } } }`}</pre>
      <p className="mt-2 text-xs text-foreground-muted">{t("settings.integrations.toolsHint")}</p>
    </Card>
  );
}

export function IntegrationsTab() {
  const { data: keys, isLoading } = useApiKeys();
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [revealed, setRevealed] = useState<ApiKeyWithSecrets | null>(null);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("settings.integrations.title")}</h2>
            <p className="mt-1 text-sm text-foreground/60">
              {t("settings.integrations.desc")}
            </p>
          </div>
          <KeyRound className="h-5 w-5 shrink-0 text-foreground/30" aria-hidden="true" />
        </div>
        <Button
          className="mt-4"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("settings.integrations.newKey")}
        </Button>

        {isLoading ? (
          <p className="mt-4 text-sm text-foreground/50">{t("settings.integrations.loading")}</p>
        ) : !keys || keys.length === 0 ? (
          <p className="mt-4 text-sm text-foreground/50">{t("settings.integrations.empty")}</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-border">
            {keys.map((k) => (
              <ApiKeyRow
                key={k.id}
                apiKey={k}
                onEdit={() => {
                  setEditing(k);
                  setFormOpen(true);
                }}
                onRevealed={setRevealed}
              />
            ))}
          </ul>
        )}
      </Card>

      <ApiGuide />

      {formOpen && (
        <ApiKeyFormModal
          editing={editing}
          onClose={() => setFormOpen(false)}
          onCreated={(result) => {
            setFormOpen(false);
            setRevealed(result);
          }}
        />
      )}
      {revealed && <SecretRevealModal result={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  onEdit,
  onRevealed,
}: {
  apiKey: ApiKey;
  onEdit: () => void;
  onRevealed: (r: ApiKeyWithSecrets) => void;
}) {
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  const update = useUpdateApiKey();
  const del = useDeleteApiKey();

  async function toggleRevoke() {
    const result = await withPasswordConfirm(apiKey.revoked ? t("settings.integrations.confirmReenable") : t("settings.integrations.confirmRevoke"), (confirmPassword) =>
      update.mutateAsync({ id: apiKey.id, revoked: !apiKey.revoked, confirmPassword })
    );
    if (result) show(apiKey.revoked ? t("settings.integrations.keyReenabled") : t("settings.integrations.keyRevoked"), "success");
  }

  async function remove() {
    if (!window.confirm(t("settings.integrations.confirmDelete", { name: apiKey.name }))) return;
    const result = await withPasswordConfirm(t("settings.integrations.confirmDeleteKey"), (confirmPassword) =>
      del.mutateAsync({ id: apiKey.id, confirmPassword })
    );
    if (result !== undefined) show(t("settings.integrations.keyDeleted"), "success");
  }

  void onRevealed; // reserved for a future "rotate" action on this row

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{apiKey.name}</p>
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand" title={apiKey.scopes.join(", ")}>
            {apiKey.scopes.length === 1 ? t("settings.integrations.permissionOne", { count: apiKey.scopes.length }) : t("settings.integrations.permissionMany", { count: apiKey.scopes.length })}
          </span>
          {apiKey.revoked && (
            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">{t("settings.integrations.revoked")}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-foreground/50">
          nk_live_{apiKey.keyPrefix}… · {apiKey.webhookUrl ? t("settings.integrations.webhookConfigured") : t("settings.integrations.noWebhook")} ·{" "}
          {apiKey.lastUsedAt ? t("settings.integrations.lastUsed", { time: new Date(apiKey.lastUsedAt).toLocaleString() }) : t("settings.integrations.neverUsed")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onEdit}>
          {t("settings.integrations.edit")}
        </Button>
        <Button variant="secondary" onClick={toggleRevoke} disabled={update.isPending}>
          {apiKey.revoked ? t("settings.integrations.reenable") : t("settings.integrations.revoke")}
        </Button>
        <Button variant="danger" onClick={remove} disabled={del.isPending}>
          {t("settings.integrations.delete")}
        </Button>
      </div>
    </li>
  );
}

// Conditionally mounted by the parent instead of taking an `open` prop —
// see feedback memory on this app's react-hooks/set-state-in-effect rule:
// initializing state from props needs a clean mount, not an effect that
// resets on every open.
function ApiKeyFormModal({
  editing,
  onClose,
  onCreated,
}: {
  editing: ApiKey | null;
  onClose: () => void;
  onCreated: (result: ApiKeyWithSecrets) => void;
}) {
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  const create = useCreateApiKey();
  const update = useUpdateApiKey();
  const [name, setName] = useState(editing?.name ?? "");
  const [scopes, setScopes] = useState<string[]>(editing?.scopes ?? ["products:read"]);
  const [webhookUrl, setWebhookUrl] = useState(editing?.webhookUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        // Only send `webhookUrl` when it actually changed — the backend
        // rotates the webhook secret whenever that field is present in a
        // PUT, so including it unchanged on every rename/toggle edit would
        // silently invalidate a storefront's already-configured secret.
        const webhookChanged = webhookUrl !== (editing.webhookUrl ?? "");
        const result = await withPasswordConfirm(t("settings.integrations.confirmUpdateKey"), (confirmPassword) =>
          update.mutateAsync({
            id: editing.id,
            name,
            scopes,
            confirmPassword,
            ...(webhookChanged ? { webhookUrl } : {}),
          })
        );
        if (result) {
          if (result.webhookSecret) {
            onCreated(result); // webhook URL changed — new secret to show once
          } else {
            show(t("settings.integrations.keyUpdated"), "success");
            onClose();
          }
        }
      } else {
        const result = await withPasswordConfirm(t("settings.integrations.confirmCreateKey"), (confirmPassword) =>
          create.mutateAsync({ name, scopes, webhookUrl, confirmPassword })
        );
        if (result) onCreated(result);
      }
    } catch (err) {
      setError(describeApiError(err, t("settings.integrations.saveKeyFailed")));
    }
  }

  return (
    <div className="backdrop-in fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[rgb(8_28_18/0.32)] px-4 py-6" role="dialog" aria-modal="true">
      <Card className="dialog-in w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-foreground">{editing ? t("settings.integrations.editKeyTitle") : t("settings.integrations.newKeyTitle")}</h2>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <Field
            label={t("settings.integrations.name")}
            placeholder={t("settings.integrations.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">{t("settings.integrations.permissions")}</legend>
            {SCOPE_INFO.map((sc) => (
              <label key={sc.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--brand)]" checked={scopes.includes(sc.key)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, sc.key] : cur.filter((x) => x !== sc.key)))} />
                <span><span className="font-medium">{t(sc.label)}</span><span className="block text-xs text-foreground/50">{t(sc.hint)}</span></span>
              </label>
            ))}
          </fieldset>
          <div>
            <Field
              label={t("settings.integrations.webhookUrl")}
              type="url"
              placeholder="https://your-storefront.com/api/webhooks/nodedr-pos"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <p className="mt-1 text-xs text-foreground/50">
              {t("settings.integrations.webhookHint")}
            </p>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-1 flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
              {t("settings.integrations.cancel")}
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || !name || scopes.length === 0}>
              {busy ? t("settings.integrations.saving") : editing ? t("settings.integrations.saveChanges") : t("settings.integrations.createKey")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function SecretRevealModal({ result, onClose }: { result: ApiKeyWithSecrets; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-lg p-6">
        <h2 className="text-base font-semibold text-foreground">
          {result.apiKey ? t("settings.integrations.keyCreated") : t("settings.integrations.secretRotated")}
        </h2>
        <p className="mt-1 text-sm text-warning">
          {t("settings.integrations.copyOnce")}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {result.apiKey && <SecretField label="settings.integrations.apiKeyLabel" value={result.apiKey} />}
          {result.webhookSecret && <SecretField label="settings.integrations.signingSecret" value={result.webhookSecret} />}
        </div>
        {result.apiKey && (
          <p className="mt-3 text-xs text-foreground/50">
            {t("settings.integrations.sendAsBefore")}<code className="rounded bg-surface-muted px-1 py-0.5">Authorization: Bearer &lt;key&gt;</code>{t("settings.integrations.sendAsMiddle")}<code className="rounded bg-surface-muted px-1 py-0.5">/api/external/...</code>.
          </p>
        )}
        {result.webhookSecret && (
          <p className="mt-1 text-xs text-foreground/50">
            {t("settings.integrations.verifyBefore")}<code className="rounded bg-surface-muted px-1 py-0.5">X-Nodedr-Signature</code>{t("settings.integrations.verifyMiddle")}<code className="rounded bg-surface-muted px-1 py-0.5">sha256=&lt;hex&gt;</code>.
          </p>
        )}
        <Button className="mt-5 w-full" onClick={onClose}>
          {t("settings.integrations.copiedClose")}
        </Button>
      </Card>
    </div>
  );
}

function SecretField({ label, value }: { label: TranslationKey; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{t(label)}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-xs text-foreground">
          {value}
        </code>
        <Button type="button" variant="secondary" onClick={copy} aria-label={t("settings.integrations.copyAria", { label: t(label) })}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}
