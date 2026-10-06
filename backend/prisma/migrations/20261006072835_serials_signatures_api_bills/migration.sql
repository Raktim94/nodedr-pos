-- CreateTable
CREATE TABLE "SerialUnit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "serial" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SOLD',
    "invoiceItemId" INTEGER,
    "soldAt" DATETIME,
    "warrantyEndsAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SerialUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SerialUnit_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SerialEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serialId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "invoiceId" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SerialEvent_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "SerialUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiKey" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "canWrite" BOOLEAN NOT NULL DEFAULT false,
    "scopes" TEXT NOT NULL DEFAULT 'products:read',
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "lastUsedAt" DATETIME,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ApiKey" ("canWrite", "createdAt", "id", "keyHash", "keyPrefix", "lastUsedAt", "name", "revoked", "webhookSecret", "webhookUrl") SELECT "canWrite", "createdAt", "id", "keyHash", "keyPrefix", "lastUsedAt", "name", "revoked", "webhookSecret", "webhookUrl" FROM "ApiKey";
DROP TABLE "ApiKey";
ALTER TABLE "new_ApiKey" RENAME TO "ApiKey";
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE TABLE "new_Invoice" (
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
    "dueAmount" REAL NOT NULL DEFAULT 0,
    "previousDuePaid" REAL NOT NULL DEFAULT 0,
    "returnValue" REAL NOT NULL DEFAULT 0,
    "creditApplied" REAL NOT NULL DEFAULT 0,
    "refundValue" REAL NOT NULL DEFAULT 0,
    "refundMode" TEXT,
    "pointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'POS',
    "externalRef" TEXT,
    "apiKeyId" INTEGER,
    "cashierName" TEXT,
    "customerSignature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amountPaid", "changeDue", "createdAt", "creditApplied", "customerId", "customerName", "customerPhone", "discountAmount", "discountType", "discountValue", "dueAmount", "id", "invoiceNumber", "loyaltyDiscount", "paymentMethod", "pointsEarned", "pointsRedeemed", "previousDuePaid", "refundMode", "refundValue", "returnValue", "subtotal", "taxAmount", "totalAmount") SELECT "amountPaid", "changeDue", "createdAt", "creditApplied", "customerId", "customerName", "customerPhone", "discountAmount", "discountType", "discountValue", "dueAmount", "id", "invoiceNumber", "loyaltyDiscount", "paymentMethod", "pointsEarned", "pointsRedeemed", "previousDuePaid", "refundMode", "refundValue", "returnValue", "subtotal", "taxAmount", "totalAmount" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE UNIQUE INDEX "Invoice_apiKeyId_externalRef_key" ON "Invoice"("apiKeyId", "externalRef");
CREATE TABLE "new_InvoiceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InvoiceItem" ("id", "invoiceId", "name", "price", "productId", "quantity", "taxAmount", "taxRate", "total", "unit") SELECT "id", "invoiceId", "name", "price", "productId", "quantity", "taxAmount", "taxRate", "total", "unit" FROM "InvoiceItem";
DROP TABLE "InvoiceItem";
ALTER TABLE "new_InvoiceItem" RENAME TO "InvoiceItem";
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceItem_productId_idx" ON "InvoiceItem"("productId");
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "barcode" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "hsn" TEXT,
    "unit" TEXT,
    "purchasePrice" REAL NOT NULL,
    "sellingPrice" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "discountType" TEXT,
    "discountValue" REAL NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "trackSerial" BOOLEAN NOT NULL DEFAULT false,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("barcode", "category", "createdAt", "discountType", "discountValue", "hsn", "id", "name", "purchasePrice", "sellingPrice", "sku", "stock", "taxRate", "unit", "updatedAt") SELECT "barcode", "category", "createdAt", "discountType", "discountValue", "hsn", "id", "name", "purchasePrice", "sellingPrice", "sku", "stock", "taxRate", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE TABLE "new_ShopSettings" (
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
    "panNumber" TEXT,
    "defaultTaxRate" REAL NOT NULL DEFAULT 0,
    "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerUnit" REAL NOT NULL DEFAULT 0,
    "pointValue" REAL NOT NULL DEFAULT 0,
    "receiptHeader" TEXT,
    "receiptFooter" TEXT NOT NULL DEFAULT 'Thank You! Visit Again.',
    "showGst" BOOLEAN NOT NULL DEFAULT true,
    "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT false,
    "usbPrinterWidth" INTEGER NOT NULL DEFAULT 80,
    "autoPrintMethod" TEXT NOT NULL DEFAULT 'browser',
    "lowStockAlert" INTEGER NOT NULL DEFAULT 5,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "pincode" TEXT,
    "signatureFile" TEXT,
    "signatoryName" TEXT,
    "invoiceLayout" TEXT NOT NULL DEFAULT 'receipt',
    "upiId" TEXT,
    "termsText" TEXT
);
INSERT INTO "new_ShopSettings" ("address1", "address2", "allowNegativeStock", "autoPrintMethod", "autoPrintReceipt", "city", "currencyCode", "currencySymbol", "defaultTaxRate", "email", "gstEnabled", "gstNumber", "id", "legalName", "lowStockAlert", "loyaltyEnabled", "panNumber", "phone", "pincode", "pointValue", "pointsPerUnit", "receiptFooter", "receiptHeader", "shopName", "showGst", "state", "usbPrinterWidth") SELECT "address1", "address2", "allowNegativeStock", "autoPrintMethod", "autoPrintReceipt", "city", "currencyCode", "currencySymbol", "defaultTaxRate", "email", "gstEnabled", "gstNumber", "id", "legalName", "lowStockAlert", "loyaltyEnabled", "panNumber", "phone", "pincode", "pointValue", "pointsPerUnit", "receiptFooter", "receiptHeader", "shopName", "showGst", "state", "usbPrinterWidth" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SerialUnit_serial_key" ON "SerialUnit"("serial");

-- CreateIndex
CREATE INDEX "SerialUnit_productId_status_idx" ON "SerialUnit"("productId", "status");

-- CreateIndex
CREATE INDEX "SerialUnit_invoiceItemId_idx" ON "SerialUnit"("invoiceItemId");

-- CreateIndex
CREATE INDEX "SerialEvent_serialId_idx" ON "SerialEvent"("serialId");

-- Existing keys keep exactly the access they had: read-only keys stay
-- read-only, write keys keep stock adjustment.
UPDATE "ApiKey" SET "scopes" = CASE WHEN "canWrite" = 1 THEN 'products:read,stock:write' ELSE 'products:read' END;
