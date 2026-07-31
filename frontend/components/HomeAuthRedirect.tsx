"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/useAuth";

export function HomeAuthRedirect() {
  const router = useRouter();
  const { data: me, isSuccess } = useMe();

  useEffect(() => {
    if (isSuccess && me) {
      router.replace("/dashboard");
    }
  }, [isSuccess, me, router]);

  return null;
}
