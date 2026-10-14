"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { clsx } from "clsx";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import { useTranslation } from "@/components/I18nProvider";

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("language.change")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("language.change")}
        className={clsx(
          "flex h-9 items-center gap-1.5 rounded-lg px-2 text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground",
          className
        )}
      >
        <Globe className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{language}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("language.label")}
          className="glass-panel absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-xl bg-surface-elevated py-1 shadow-2xl"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              role="menuitemradio"
              aria-checked={language === option.code}
              onClick={() => {
                setLanguage(option.code);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition-colors hover:bg-surface-muted",
                language === option.code ? "font-medium text-brand" : "text-foreground"
              )}
            >
              <span className="truncate">{option.native}</span>
              {language === option.code && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
