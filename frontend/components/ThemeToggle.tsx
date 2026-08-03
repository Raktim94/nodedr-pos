"use client";

import { Moon, Sun } from "lucide-react";
import { clsx } from "clsx";
import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle({ className }: { className?: string }) {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light/dark mode"
      className={clsx(
        "flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground",
        className
      )}
    >
      <Sun className="theme-toggle-sun h-[18px] w-[18px]" aria-hidden="true" />
      <Moon className="theme-toggle-moon h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}
