// Query-cache keys shared between the places that read data and the places
// that invalidate it after a write. Keep a key here the moment a second file
// needs it, so the two can't drift apart.
export const queryKeys = {
  products: ["products"],
  customers: ["customers"],
  shopSettings: ["shop-settings"],
  stores: ["stores"],
  pos: ["pos"],
  mastersSummary: ["masters", "summary"],
  fx: ["fx"],
  apiKeys: ["api-keys"],
  announcements: ["announcements"],
  users: ["users"],
  hub: ["hub"],
  updateStatus: ["update-status"],
  syncConfig: ["sync-config"],
  suppliers: ["suppliers"],
  reorder: ["reorder"],
  orders: ["orders"],
  emailReports: ["email-reports"],
} as const;
