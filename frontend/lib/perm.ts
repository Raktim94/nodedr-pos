import type { AuthUser, Permission } from "./types";

// Mirrors backend hasPerm(): admins can do everything, a franchisor is
// read-only and only sees reports, everyone else needs the named right.
export const isAdmin = (user: AuthUser | undefined): boolean => user?.role === "admin";
export const isFranchisor = (user: AuthUser | undefined): boolean => user?.role === "franchisor";

export function can(user: AuthUser | undefined, perm: Permission): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (isFranchisor(user)) return perm === "reports";
  return user.permissions.includes(perm);
}
