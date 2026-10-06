"use client";

// Heavy chart code lives here so it is lazy-loaded (next/dynamic) only when
// the Reports page is opened. Lines draw once on first entry; the underlying
// numbers are always available in the tables beside them.
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Overview } from "@/hooks/useReports";

const COLORS = ["#176c45", "#3d9a69", "#bfe8ce", "#d89a43", "#7aa88f", "#0d3b28", "#a8c9b4"];

export function RevenueArea({ data, sym }: { data: Overview["daily"]; sym: string }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }));
  return (
    <div className="h-64 w-full" role="img" aria-label={`Daily revenue, ${rows.length} days`}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#176c45" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#176c45" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={24} stroke="var(--foreground-muted)" />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} stroke="var(--foreground-muted)" tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                  <p className="font-medium">{String(payload[0].payload.label)}</p>
                  <p className="tabular text-foreground-muted">{sym} {Number(payload[0].payload.revenue).toFixed(2)} · {payload[0].payload.bills} bills</p>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="revenue" stroke="#176c45" strokeWidth={2} fill="url(#revFill)" isAnimationActive animationDuration={700} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-52 w-full" role="img" aria-label="Revenue by category">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" isAnimationActive animationDuration={700}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => Number(v).toFixed(2)} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export const CATEGORY_COLORS = COLORS;
