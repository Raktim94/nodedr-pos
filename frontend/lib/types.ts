export interface Product {
  id: number;
  barcode: string;
  name: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShopSettings {
  id: number;
  shopName: string;
  address1: string;
  address2: string | null;
  currency: string;
  lowStockAlert: number;
}

export interface InvoiceItem {
  id: number;
  productId: number;
  name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string | null;
  totalAmount: number;
  createdAt: string;
  items: InvoiceItem[];
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}
