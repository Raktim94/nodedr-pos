import type { AuthUser, Permission } from "./types";

// Mirrors backend hasPerm(): admins can do everything, a franchisor is
// read-only and only sees reports, everyone else needs the named right.
export function can(user: AuthUser | undefined, perm: Permission): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "franchisor") return perm === "reports";
  return user.permissions.includes(perm);
}
