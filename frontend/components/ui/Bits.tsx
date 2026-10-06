import { clsx } from "clsx";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.025em] text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-foreground-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "brand";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-foreground-muted",
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-danger-soft text-danger",
  brand: "bg-brand-soft text-brand",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", tones[tone], className)}>{children}</span>;
}

export function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={clsx("tabular text-xs font-semibold", up ? "text-success" : "text-danger")}>
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  index = 0,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  index?: number;
  accent?: boolean;
}) {
  return (
    <div className={clsx("rise rounded-2xl border p-5", accent ? "border-transparent bg-[var(--green-900)] text-white" : "card-surface")} style={{ "--i": index } as React.CSSProperties}>
      <p className={clsx("text-xs font-medium", accent ? "text-white/70" : "text-foreground-muted")}>{label}</p>
      <p className="num-xl mt-2">{value}</p>
      {sub && <div className={clsx("mt-2 text-xs", accent ? "text-white/70" : "text-foreground-muted")}>{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      {icon && <div className="text-foreground-muted">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-sm text-foreground-muted">{hint}</p>}
    </div>
  );
}
