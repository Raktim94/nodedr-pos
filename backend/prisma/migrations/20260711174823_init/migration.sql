-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopName" TEXT NOT NULL,
    "legalName" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "currencySymbol" TEXT NOT NULL DEFAULT 'Rs.',
    "gstEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gstNumber" TEXT,
    "defaultTaxRate" REAL NOT NULL DEFAULT 0,
    "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerUnit" REAL NOT NULL DEFAULT 0,
    "pointValue" REAL NOT NULL DEFAULT 0,
    "receiptHeader" TEXT,
    "receiptFooter" TEXT NOT NULL DEFAULT 'Thank You! Visit Again.',
    "showGst" BOOLEAN NOT NULL DEFAULT true,
    "lowStockAlert" INTEGER NOT NULL DEFAULT 5
);

-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "hsn" TEXT,
    "purchasePrice" REAL NOT NULL,
    "sellingPrice" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" REAL NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL DEFAULT 'Walk-in Customer',
    "customerPhone" TEXT,
    "subtotal" REAL NOT NULL,
    "discountType" TEXT,
    "discountValue" REAL NOT NULL DEFAULT 0,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "loyaltyDiscount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "amountPaid" REAL NOT NULL DEFAULT 0,
    "changeDue" REAL NOT NULL DEFAULT 0,
    "pointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
