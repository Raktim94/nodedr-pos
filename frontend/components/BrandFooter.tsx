"use client";

import { useTranslation } from "@/components/I18nProvider";

export function BrandFooter({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={`text-center text-[11px] leading-tight text-foreground/40 ${className ?? ""}`}>
      {t("brand.developedBy")}{" "}
      <a
        href="https://www.nodedr.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-foreground/60 hover:text-brand hover:underline"
      >
        NodeDR Infotech Private Limited
      </a>
    </p>
  );
}
