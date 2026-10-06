"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Printer, Trash2 } from "lucide-react";
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
      <MenuCard />
      <StoresCard />
      <AnnouncementsCard />
    </div>
  );
}

function MenuCard() {
  const [table, setTable] = useState("");
  const [img, setImg] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}/menu${table.trim() ? `?table=${encodeURIComponent(table.trim())}` : ""}` : "";
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 280 }).then(setImg).catch(() => setImg(""));
  }, [url]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">QR menu &amp; click-and-collect</h2>
      <p className="text-sm text-foreground-muted">Customers scan a QR, browse the products you tick <b>Show on the public QR menu</b> in Inventory, and order for dine-in or pickup. Orders land on the <b>Online orders</b> board with stock reserved. Phones must be able to reach this address — on a shop network use the till&apos;s LAN address, or publish it with HTTPS.</p>
      <Field label="Table number (blank = pickup menu)" value={table} onChange={(e) => setTable(e.target.value)} maxLength={20} />
      <div className="flex flex-wrap items-center gap-4">
        {img && /* eslint-disable-next-line @next/next/no-img-element */ <img src={img} alt={`QR code for ${url}`} width={140} height={140} className="rounded-lg border border-border bg-white p-1.5" />}
        <div className="min-w-0 flex-1">
          <code className="block break-all rounded-lg bg-surface-muted px-3 py-2 text-xs">{url}</code>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(url)}><Copy className="h-4 w-4" aria-hidden="true" /> Copy link</Button>
            <Button variant="secondary" onClick={() => { const w = window.open("", "_blank", "width=420,height=560"); if (w) { w.document.title = "QR menu"; const h1 = w.document.createElement("h1"); h1.textContent = table ? `Table ${table}` : "Scan to order"; h1.style.cssText = "font:600 28px system-ui;text-align:center"; const im = w.document.createElement("img"); im.src = img; im.style.cssText = "display:block;margin:16px auto;width:300px"; w.document.body.append(h1, im); w.onload = () => w.print(); setTimeout(() => w.print(), 300); } }}><Printer className="h-4 w-4" aria-hidden="true" /> Print</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface Store { id: number; platform: "woocommerce" | "shopify" | "generic"; name: string; active: boolean; lastEventAt: string | null; webhookUrl: string; outboundConfigured: boolean; baseUrl: string; shopDomain: string; locationId: string }

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
            <Select label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} options={[{ value: "woocommerce", label: "WooCommerce" }, { value: "shopify", label: "Shopify" }, { value: "generic", label: "Other (generic signed webhook)" }]} />
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
