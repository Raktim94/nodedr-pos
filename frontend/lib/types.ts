export type Role = "admin" | "cashier";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
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
  lowStockAlert: number;
  allowNegativeStock: boolean;
  pincode: string | null;
}

export interface Product {
  id: number;
  barcode: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  loyaltyPoints: number;
  totalSpent: number;
  totalDue: number;
  visits: number;
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
  pointsRedeemed: number;
  pointsEarned: number;
  createdAt: string;
  items: InvoiceItem[];
}

export interface CartItem {
  product: Product;
  quantity: number;
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
