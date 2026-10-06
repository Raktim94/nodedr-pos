"use client";

import { useToast } from "@/components/Toast";
import { usePasswordConfirm } from "@/components/PasswordConfirm";
import { useUpdateSettings } from "@/hooks/useShopSettings";
import type { ShopSettings } from "@/lib/types";

export function useSaver() {
  const update = useUpdateSettings();
  const { show } = useToast();
  const { withPasswordConfirm } = usePasswordConfirm();
  return async (patch: Partial<ShopSettings>) => {
    const result = await withPasswordConfirm("save these settings", (confirmPassword) =>
      update.mutateAsync({ ...patch, confirmPassword })
    );
    if (result) show("Settings saved", "success");
  };
}

