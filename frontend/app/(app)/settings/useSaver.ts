"use client";

import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useTranslation } from "@/components/I18nProvider";
import { useUpdateSettings } from "@/hooks/useShopSettings";
import type { ShopSettings } from "@/lib/types";

export function useSaver() {
  const update = useUpdateSettings();
  const { show } = useToast();
  const { t } = useTranslation();
  const { withPasswordConfirm } = usePasswordConfirm();
  return async (patch: Partial<ShopSettings>) => {
    const result = await withPasswordConfirm(t("settings.saver.passwordPrompt"), (confirmPassword) =>
      update.mutateAsync({ ...patch, confirmPassword })
    );
    if (result) show(t("settings.saver.saved"), "success");
  };
}

