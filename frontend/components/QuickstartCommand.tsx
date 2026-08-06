"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { clsx } from "clsx";

const RAW_BASE = "https://raw.githubusercontent.com/Raktim94/nodedr-pos/master/scripts";

const OS_TABS = [
  {
    id: "mac",
    label: "macOS",
    command: `curl -fsSL ${RAW_BASE}/quickstart.sh | bash`,
    note: "Installs Docker Desktop via Homebrew if it's missing. macOS may show a one-time permission prompt on Docker's first launch — approve it.",
  },
  {
    id: "linux",
    label: "Linux",
    command: `curl -fsSL ${RAW_BASE}/quickstart.sh | bash`,
    note: "Installs Docker Engine via the official get.docker.com script if it's missing.",
  },
  {
    id: "windows",
    label: "Windows",
    command: `irm ${RAW_BASE}/quickstart.ps1 | iex`,
    note: "Run in PowerShell. Installs Docker Desktop via winget if it's missing — if Windows needs a restart to enable WSL2, restart and run the same command again.",
  },
] as const;

export function QuickstartCommand() {
  const [activeId, setActiveId] = useState<(typeof OS_TABS)[number]["id"]>("mac");
  const [copied, setCopied] = useState(false);
  const active = OS_TABS.find((os) => os.id === activeId)!;

  async function handleCopy() {
    await navigator.clipboard.writeText(active.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3">
      <div role="tablist" aria-label="Operating system" className="inline-flex gap-1 rounded-lg border border-border bg-surface-muted p-1">
        {OS_TABS.map((os) => (
          <button
            key={os.id}
            type="button"
            role="tab"
            aria-selected={os.id === activeId}
            onClick={() => {
              setActiveId(os.id);
              setCopied(false);
            }}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              os.id === activeId
                ? "bg-brand text-brand-foreground"
                : "text-foreground/70 hover:text-foreground"
            )}
          >
            {os.label}
          </button>
        ))}
      </div>

      <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-2.5">
        <code className="flex-1 overflow-x-auto whitespace-nowrap text-left text-xs text-foreground/80 sm:text-sm">
          {active.command}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy command"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-border hover:text-foreground"
        >
          {copied ? <Check className="h-4 w-4 text-green-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      <p className="max-w-md text-xs text-foreground/60">{active.note}</p>
      <p className="text-xs text-foreground/60">
        One command, checks for Docker and installs it if it&apos;s missing, then installs and starts
        nodedr-pos.{" "}
        <a
          href={`${RAW_BASE}/${active.id === "windows" ? "quickstart.ps1" : "quickstart.sh"}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Read the script before running it
        </a>
        .
      </p>
    </div>
  );
}
