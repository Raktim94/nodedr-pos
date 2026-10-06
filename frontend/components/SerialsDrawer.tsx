"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Bits";
import { Modal } from "@/components/ui/Modal";
import { api, describeApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/types";

interface Unit { id: number; serial: string; status: "IN_STOCK" | "SOLD" | "DEFECTIVE"; soldAt: string | null; warrantyEndsAt: string | null }

// Manage the IMEI / serial units of one tracked product: receive new units
// (paste or scan a list), see sold / defective ones, mark a unit defective.
export function SerialsDrawer({ product, onClose }: { product: Product; onClose: () => void }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"IN_STOCK" | "SOLD" | "DEFECTIVE">("IN_STOCK");
  const [text, setText] = useState("");
  const [rejected, setRejected] = useState<{ serial: string; reason: string }[]>([]);

  const { data: units = [], isLoading } = useQuery({ queryKey: ["serials", product.id, status], queryFn: () => api.get<Unit[]>(`/products/${product.id}/serials?status=${status}`) });

  const add = useMutation({
    mutationFn: () => api.post<{ added: number; rejected: { serial: string; reason: string }[]; stock: number }>(`/products/${product.id}/serials`, { serials: text.split(/[\s,;]+/).filter(Boolean) }),
    onSuccess: (r) => {
      setRejected(r.rejected);
      setText("");
      show(`${r.added} unit${r.added === 1 ? "" : "s"} added${r.rejected.length ? `, ${r.rejected.length} rejected` : ""}`, r.rejected.length ? "info" : "success");
      qc.invalidateQueries({ queryKey: ["serials", product.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => show(describeApiError(e, "Could not add units"), "error"),
  });
  const flag = useMutation({
    mutationFn: ({ serial, to }: { serial: string; to: "IN_STOCK" | "DEFECTIVE" }) => api.patch(`/products/serials/${encodeURIComponent(serial)}`, { status: to }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["serials", product.id] }); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e) => show(describeApiError(e, "Failed"), "error"),
  });

  return (
    <Modal title={`Units · ${product.name}`} variant="drawer" onClose={onClose}>
      <form className="mb-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <label htmlFor="new-serials" className="text-sm font-medium">Receive units (one IMEI / serial per line, or scan each)</label>
        <textarea id="new-serials" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={"490154203237518\n356938035643809"} className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" />
        <Button type="submit" disabled={add.isPending || !text.trim()}>{add.isPending ? "Adding…" : "Add units"}</Button>
        {rejected.length > 0 && (
          <ul className="rounded-lg bg-warning-soft p-2 text-xs text-warning">{rejected.slice(0, 8).map((r) => <li key={r.serial}><span className="font-mono">{r.serial}</span> — {r.reason}</li>)}</ul>
        )}
      </form>
      <div role="tablist" aria-label="Unit status" className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-xs">
        {(["IN_STOCK", "SOLD", "DEFECTIVE"] as const).map((st) => (
          <button key={st} role="tab" aria-selected={status === st} onClick={() => setStatus(st)} className={`rounded-md px-3 py-1.5 font-medium ${status === st ? "bg-brand text-brand-foreground" : "text-foreground-muted"}`}>{st.replace("_", " ").toLowerCase()}</button>
        ))}
      </div>
      {isLoading ? <p className="text-sm text-foreground-muted">Loading…</p> : units.length === 0 ? <p className="text-sm text-foreground-muted">No units here.</p> : (
        <ul className="divide-y divide-border text-sm">
          {units.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 py-2">
              <div><p className="font-mono text-xs">{u.serial}</p>{u.soldAt && <p className="text-xs text-foreground-muted">sold {new Date(u.soldAt).toLocaleDateString()}{u.warrantyEndsAt ? ` · warranty to ${new Date(u.warrantyEndsAt).toLocaleDateString()}` : ""}</p>}</div>
              {u.status === "IN_STOCK" && <Button variant="ghost" onClick={() => flag.mutate({ serial: u.serial, to: "DEFECTIVE" })}>Mark defective</Button>}
              {u.status === "DEFECTIVE" && <Button variant="ghost" onClick={() => flag.mutate({ serial: u.serial, to: "IN_STOCK" })}>Back in stock</Button>}
              {u.status === "SOLD" && <Badge tone="brand">sold</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
