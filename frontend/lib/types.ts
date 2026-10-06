export type Role = "admin" | "cashier" | "franchisor";

export type Permission = "discount" | "returns" | "reports" | "inventory" | "customers" | "orders" | "purchasing";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  permissions: Permission[];
  maxDiscountPercent: number | null;
}

export interface ShopSettings {
  id: number;
  shopName: string;
  legalName: string | null;
  address1: string;
  address2: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  currencyCode: string;
  currencySymbol: string;
  gstEnabled: boolean;
  gstNumber: string | null;
  panNumber: string | null;
  defaultTaxRate: number;
  loyaltyEnabled: boolean;
  pointsPerUnit: number;
  pointValue: number;
  receiptHeader: string | null;
  receiptFooter: string;
  showGst: boolean;
  autoPrintReceipt: boolean;
  usbPrinterWidth: number;
  autoPrintMethod: "browser" | "usb";
  lowStockAlert: number;
  allowNegativeStock: boolean;
  pincode: string | null;
  signatureFile: string | null;
  signatoryName: string | null;
  invoiceLayout: "receipt" | "a4";
  upiId: string | null;
  termsText: string | null;
  cashDrawer: boolean;
  serialTracking: boolean;
  terminalProvider: "none" | "stripe" | "square";
  fxRates: string | null;
  reportEmail: string | null;
  reportFrequency: "off" | "daily" | "weekly";
  syncRole: "none" | "branch" | "hub";
}

export interface Product {
  id: number;
  barcode: string;
  // Links this product to an external system (e.g. an e-commerce
  // storefront) over the External Stock API — see Settings > Integrations.
  sku: string | null;
  name: string;
  category: string | null;
  hsn: string | null;
  unit: string | null;
  purchasePrice: number;
  sellingPrice: number;
  taxRate: number;
  discountType: "percent" | "amount" | null;
  discountValue: number;
  stock: number;
  trackSerial: boolean;
  warrantyMonths: number;
  reorderPoint: number;
  supplierId: number | null;
  createdAt: string;
  updatedAt: string;
}

// A credential for an external system to call the External Stock API.
// Never carries the plaintext key or webhook secret except right after
// creation/rotation — see Settings > Integrations.
export interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  canWrite: boolean;
  scopes: string[];
  webhookUrl: string | null;
  webhookSecretSet: boolean;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
}

// Only present in the response right after POST/PATCH — the one moment the
// admin can see (and must copy down) the real secrets.
export interface ApiKeyWithSecrets extends ApiKey {
  apiKey?: string;
  webhookSecret?: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  loyaltyPoints: number;
  totalSpent: number;
  totalDue: number;
  creditBalance: number;
  visits: number;
  gstin: string | null;
  cardUid: string | null;
  createdAt: string;
}

export interface InvoiceItem {
  id: number;
  productId: number;
  name: string;
  unit: string | null;
  quantity: number;
  price: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  warrantyMonths?: number;
  serials?: { serial: string; warrantyEndsAt: string | null }[];
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  subtotal: number;
  discountType: "percent" | "amount" | null;
  discountValue: number;
  discountAmount: number;
  taxAmount: number;
  loyaltyDiscount: number;
  totalAmount: number;
  paymentMethod: "CASH" | "UPI" | "CARD";
  amountPaid: number;
  changeDue: number;
  dueAmount: number;
  previousDuePaid: number;
  returnValue: number;
  creditApplied: number;
  refundValue: number;
  refundMode: "CASH" | "CREDIT" | null;
  pointsRedeemed: number;
  pointsEarned: number;
  source?: string;
  cashierName?: string | null;
  payCurrency?: string | null;
  payRate?: number | null;
  payAmount?: number | null;
  createdAt: string;
  items: InvoiceItem[];
}

export interface CartItem {
  product: Product;
  quantity: number;
  // IMEI / serial numbers for serial-tracked products (quantity === serials.length).
  serials?: string[];
}

export type PaymentMethod = "CASH" | "UPI" | "CARD";

export type RefundMethod = "CASH" | "UPI" | "CARD" | "DUE_ADJUST";

export interface ReturnItem {
  id: number;
  invoiceItemId: number;
  productId: number;
  name: string;
  quantity: number;
  refundAmount: number;
}

export interface ReturnRecord {
  id: number;
  invoiceId: number;
  customerId: number | null;
  totalRefund: number;
  refundMethod: RefundMethod;
  note: string | null;
  createdAt: string;
  items: ReturnItem[];
}

export interface Order {
  id: number;
  channel: string;
  externalId: string | null;
  status: "NEW" | "PACKING" | "READY" | "COLLECTED" | "CANCELLED";
  fulfilment: "PICKUP" | "DELIVERY";
  pickupCode: string;
  customerName: string;
  customerPhone: string | null;
  total: number;
  paid: boolean;
  invoiceId: number | null;
  createdAt: string;
  items: { productId: number; name: string; quantity: number; price: number }[];
}

export interface WarrantyResult {
  serial: string;
  status: "SOLD" | "RETURNED";
  warranty: "ACTIVE" | "EXPIRED" | "RETURNED" | "NO_WARRANTY";
  warrantyMonths: number;
  soldAt: string | null;
  warrantyEndsAt: string | null;
  daysLeft: number | null;
  product: { id: number; name: string; sku: string | null; barcode: string };
  invoice: { id: number; invoiceNumber: string; date: string; customerName?: string; customerPhone?: string } | null;
  history: { type: string; note: string | null; at: string }[];
}

export interface Shift {
  id: number;
  userName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: number;
  expectedCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  bills: number;
  salesByMethod: Record<string, number>;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
}
