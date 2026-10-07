"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { api, describeApiError } from "@/lib/api";

export function OnlineTab() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <StoresCard />
      <CustomWebsiteCard />
      <AnnouncementsCard />
    </div>
  );
}

interface Store { id: number; platform: "woocommerce" | "shopify" | "generic"; name: string; active: boolean; lastEventAt: string | null; webhookUrl: string; outboundConfigured: boolean; baseUrl: string; shopDomain: string; locationId: string }

function CustomWebsiteCard() {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}/api/external`;
  const example = `curl -X POST ${base}/orders \\
  -H "Authorization: Bearer nk_live_…" -H "Content-Type: application/json" \\
  -d '{"externalId":"web-1001","customer":{"name":"Meena","phone":"98765…"},"items":[{"sku":"COLA-1","quantity":2}],"paid":true}'`;
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div>
        <h2 className="text-base font-semibold">Your own website (API)</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Built your own online store? Send its orders to the POS with a small REST call. The POS reserves stock, lets you pack and hand over, and tells your site each status change. Send paid: true if your website already charged the customer (no POS bill); send paid: false for pay-at-pickup and the POS bills it at hand-over.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground-muted">
        <li>Give the products you sell online a <b>SKU</b> (Inventory → edit).</li>
        <li>Create an API key with <b>products:read</b> and <b>orders:write</b> in <b>Integrations</b>; add a webhook URL to receive order updates.</li>
        <li>Send orders to <code className="rounded bg-surface-muted px-1 font-mono text-xs">{base || "/api/external"}/orders</code>.</li>
      </ol>
      <pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-xs leading-relaxed">{example}</pre>
      <p className="text-sm">
        <a className="font-medium text-brand hover:underline" href="https://github.com/Raktim94/nodedr-pos/blob/master/docs/CUSTOM_STORE.md" target="_blank" rel="noreferrer">Developer guide with Node and Python examples →</a>
      </p>
    </Card>
  );
}

function StoresCard() {
  const { show } = useToast();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const { data: stores = [] } = useQuery({ queryKey: ["stores"], queryFn: () => api.get<Store[]>("/integrations") });
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [cfg, setCfg] = useState<Store | null>(null);
  const [platform, setPlatform] = useState("woocommerce");
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => withPasswordConfirm("connect this store", (confirmPassword) => api.post<Store & { webhookSecret: string }>("/integrations", { platform, name, confirmPassword })),
    onSuccess: (r) => { if (r) { setAdding(false); setName(""); setSecret({ url: r.webhookUrl, secret: r.webhookSecret }); qc.invalidateQueries({ queryKey: ["stores"] }); } },
    onError: (e) => show(describeApiError(e, "Could not connect"), "error"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => withPasswordConfirm("disconnect this store", (confirmPassword) => api.delete(`/integrations/${id}`, { confirmPassword })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stores"] }),
  });

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">WooCommerce, Shopify &amp; other stores</h2>
          <p className="mt-1 text-sm text-foreground-muted">Orders arrive by signed webhook and become pickup/delivery orders; stock changes here are pushed back to the store. Products are matched by <b>SKU</b>.</p>
        </div>
        <Button onClick={() => setAdding(true)}>Connect</Button>
      </div>
      <ul className="divide-y divide-border">
        {stores.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.name} <Badge tone="brand">{s.platform}</Badge> {!s.active && <Badge tone="bad">paused</Badge>}</p>
              <p className="truncate text-xs text-foreground-muted">{s.outboundConfigured ? "stock sync on" : "stock sync off"} · {s.lastEventAt ? `last order ${new Date(s.lastEventAt).toLocaleString()}` : "no orders yet"}</p>
              <code className="block truncate text-[11px] text-foreground-muted">{s.webhookUrl}</code>
            </div>
            <div className="flex gap-2">
              {s.platform !== "generic" && <Button variant="secondary" onClick={() => setCfg(s)}>Stock sync</Button>}
              <Button variant="ghost" aria-label={`Disconnect ${s.name}`} onClick={() => remove.mutate(s.id)}><Trash2 className="h-4 w-4 text-danger" aria-hidden="true" /></Button>
            </div>
          </li>
        ))}
        {stores.length === 0 && <li className="py-3 text-sm text-foreground-muted">No stores connected.</li>}
      </ul>
      {adding && (
        <Modal title="Connect a store" onClose={() => setAdding(false)} size="sm">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Select label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} options={[{ value: "woocommerce", label: "WooCommerce" }, { value: "shopify", label: "Shopify" }, { value: "generic", label: "Custom website (signed webhook)" }]} />
            <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="My online shop" />
            <Button type="submit" disabled={!name.trim() || create.isPending}>Connect</Button>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal title="Add this webhook to your store" onClose={() => setSecret(null)} closeOnBackdrop={false}>
          <p className="mb-2 text-sm text-warning">Copy the secret now — it is shown only once.</p>
          <p className="text-xs font-medium">Delivery URL</p><code className="mb-2 block break-all rounded-lg bg-surface-muted p-2 text-xs">{secret.url}</code>
          <p className="text-xs font-medium">Secret</p><code className="block break-all rounded-lg bg-surface-muted p-2 text-xs">{secret.secret}</code>
          <p className="mt-3 text-xs text-foreground-muted">WooCommerce: Settings → Advanced → Webhooks → topic “Order created”. Shopify: Settings → Notifications → Webhooks → “Order creation”, then paste the secret into the signing key. The URL must be reachable from the internet (HTTPS).</p>
          <Button className="mt-3 w-full" onClick={() => setSecret(null)}>I&apos;ve copied it</Button>
        </Modal>
      )}
      {cfg && <OutboundDialog store={cfg} onClose={() => setCfg(null)} />}
    </Card>
  );
}

function OutboundDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const { withPasswordConfirm } = usePasswordConfirm();
  const [f, setF] = useState({ baseUrl: store.baseUrl, consumerKey: "", consumerSecret: "", shopDomain: store.shopDomain, accessToken: "", locationId: store.locationId });
  const save = useMutation({
    mutationFn: () => {
      const body = store.platform === "woocommerce" ? { baseUrl: f.baseUrl, ...(f.consumerKey ? { consumerKey: f.consumerKey } : {}), ...(f.consumerSecret ? { consumerSecret: f.consumerSecret } : {}) } : { shopDomain: f.shopDomain, locationId: f.locationId, ...(f.accessToken ? { accessToken: f.accessToken } : {}) };
      return withPasswordConfirm("save stock-sync credentials", (confirmPassword) => api.put(`/integrations/${store.id}`, { ...body, confirmPassword }));
    },
    onSuccess: (r) => { if (r) { show("Saved — stock changes now sync to the store", "success"); qc.invalidateQueries({ queryKey: ["stores"] }); onClose(); } },
    onError: (e) => show(describeApiError(e, "Could not save"), "error"),
  });
  return (
    <Modal title={`Stock sync · ${store.name}`} onClose={onClose} size="sm">
      <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">Experimental: not yet verified against a live store. Test on a staging shop first.</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {store.platform === "woocommerce" ? (
          <>
            <Field label="Store URL (https://…)" type="url" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} />
            <Field label="REST consumer key" type="password" autoComplete="off" value={f.consumerKey} onChange={(e) => setF({ ...f, consumerKey: e.target.value })} />
            <Field label="REST consumer secret" type="password" autoComplete="off" value={f.consumerSecret} onChange={(e) => setF({ ...f, consumerSecret: e.target.value })} />
          </>
        ) : (
          <>
            <Field label="Shop domain (xxx.myshopify.com)" value={f.shopDomain} onChange={(e) => setF({ ...f, shopDomain: e.target.value })} />
            <Field label="Admin API access token" type="password" autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} />
            <Field label="Location id (gid://shopify/Location/…)" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} />
          </>
        )}
        <Button type="submit" disabled={save.isPending}>Save</Button>
      </form>
    </Modal>
  );
}

interface Ann { id: number; title: string; body: string; active: boolean }
function AnnouncementsCard() {
  const qc = useQueryClient();
  const { show } = useToast();
  const { data = [] } = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<Ann[]>("/announcements") });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api.post("/announcements", { title, body }),
    onSuccess: () => { setTitle(""); setBody(""); qc.invalidateQueries({ queryKey: ["announcements"] }); },
    onError: (e) => show(describeApiError(e, "Could not post"), "error"),
  });
  const toggle = useMutation({ mutationFn: (a: Ann) => api.put(`/announcements/${a.id}`, { active: !a.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }) });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/announcements/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }) });
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">Customer announcements</h2>
      <p className="text-sm text-foreground-muted">Shown on each customer&apos;s loyalty page. Send a customer their page from <b>Customers → Share link</b>.</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">Message<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} rows={2} className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm" /></label>
        <div><Button type="submit" disabled={!title.trim() || !body.trim() || add.isPending}>Post</Button></div>
      </form>
      <ul className="divide-y divide-border">
        {data.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
            <span className={a.active ? "" : "text-foreground-muted line-through"}><b>{a.title}</b> — {a.body}</span>
            <span className="flex shrink-0 gap-1"><Button variant="ghost" onClick={() => toggle.mutate(a)}>{a.active ? "Hide" : "Show"}</Button><Button variant="ghost" aria-label="Delete announcement" onClick={() => del.mutate(a.id)}><Trash2 className="h-4 w-4 text-danger" aria-hidden="true" /></Button></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
