-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "cardUid" TEXT;
ALTER TABLE "Customer" ADD COLUMN "gstin" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "customerGstin" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "payAmount" REAL;
ALTER TABLE "Invoice" ADD COLUMN "paymentRef" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "payCurrency" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "payRate" REAL;
ALTER TABLE "Invoice" ADD COLUMN "shiftId" INTEGER;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "number" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "totalCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" DATETIME,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitCost" REAL NOT NULL,
    "receivedQty" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "PurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "userName" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "openingFloat" REAL NOT NULL DEFAULT 0,
    "closingCounted" REAL,
    "expectedCash" REAL,
    "variance" REAL,
    "note" TEXT
);

-- CreateTable
CREATE TABLE "ShiftMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shiftId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channel" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "fulfilment" TEXT NOT NULL DEFAULT 'PICKUP',
    "pickupCode" TEXT NOT NULL,
    "customerName" TEXT NOT NULL DEFAULT 'Online Customer',
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "note" TEXT,
    "total" REAL NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paymentRef" TEXT,
    "apiKeyId" INTEGER,
    "invoiceId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "configEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastEventAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BranchStock" (
    "branchId" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "stock" REAL NOT NULL,
    "price" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("branchId", "barcode"),
    CONSTRAINT "BranchStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BranchDay" (
    "branchId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "revenue" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "count" INTEGER NOT NULL,

    PRIMARY KEY ("branchId", "day"),
    CONSTRAINT "BranchDay_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fromBranchId" INTEGER NOT NULL,
    "toBranchId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TransferItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transferId" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InvoiceItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "costPrice" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InvoiceItem" ("id", "invoiceId", "name", "price", "productId", "quantity", "taxAmount", "taxRate", "total", "unit", "warrantyMonths") SELECT "id", "invoiceId", "name", "price", "productId", "quantity", "taxAmount", "taxRate", "total", "unit", "warrantyMonths" FROM "InvoiceItem";
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
    "stock" REAL NOT NULL DEFAULT 0,
    "trackSerial" BOOLEAN NOT NULL DEFAULT false,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" REAL NOT NULL DEFAULT 0,
    "supplierId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "category", "createdAt", "discountType", "discountValue", "hsn", "id", "name", "purchasePrice", "sellingPrice", "sku", "stock", "taxRate", "trackSerial", "unit", "updatedAt", "warrantyMonths") SELECT "barcode", "category", "createdAt", "discountType", "discountValue", "hsn", "id", "name", "purchasePrice", "sellingPrice", "sku", "stock", "taxRate", "trackSerial", "unit", "updatedAt", "warrantyMonths" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE TABLE "new_ReturnItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnId" INTEGER NOT NULL,
    "invoiceItemId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "refundAmount" REAL NOT NULL,
    CONSTRAINT "ReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "Return" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnItem_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReturnItem" ("id", "invoiceItemId", "name", "productId", "quantity", "refundAmount", "returnId") SELECT "id", "invoiceItemId", "name", "productId", "quantity", "refundAmount", "returnId" FROM "ReturnItem";
DROP TABLE "ReturnItem";
ALTER TABLE "new_ReturnItem" RENAME TO "ReturnItem";
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
    "termsText" TEXT,
    "cashDrawer" BOOLEAN NOT NULL DEFAULT false,
    "terminalProvider" TEXT NOT NULL DEFAULT 'none',
    "terminalConfigEnc" TEXT,
    "fxRates" TEXT,
    "fxUpdatedAt" DATETIME,
    "reportEmail" TEXT,
    "reportFrequency" TEXT NOT NULL DEFAULT 'off',
    "reportLastSentAt" DATETIME,
    "smtpConfigEnc" TEXT,
    "syncRole" TEXT NOT NULL DEFAULT 'none',
    "syncHubUrl" TEXT,
    "syncBranchCode" TEXT,
    "syncSecretEnc" TEXT,
    "syncLastAt" DATETIME
);
INSERT INTO "new_ShopSettings" ("address1", "address2", "allowNegativeStock", "autoPrintMethod", "autoPrintReceipt", "city", "currencyCode", "currencySymbol", "defaultTaxRate", "email", "gstEnabled", "gstNumber", "id", "invoiceLayout", "legalName", "lowStockAlert", "loyaltyEnabled", "panNumber", "phone", "pincode", "pointValue", "pointsPerUnit", "receiptFooter", "receiptHeader", "shopName", "showGst", "signatoryName", "signatureFile", "state", "termsText", "upiId", "usbPrinterWidth") SELECT "address1", "address2", "allowNegativeStock", "autoPrintMethod", "autoPrintReceipt", "city", "currencyCode", "currencySymbol", "defaultTaxRate", "email", "gstEnabled", "gstNumber", "id", "invoiceLayout", "legalName", "lowStockAlert", "loyaltyEnabled", "panNumber", "phone", "pincode", "pointValue", "pointsPerUnit", "receiptFooter", "receiptHeader", "shopName", "showGst", "signatoryName", "signatureFile", "state", "termsText", "upiId", "usbPrinterWidth" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "permissions" TEXT NOT NULL DEFAULT '',
    "maxDiscountPercent" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("active", "createdAt", "email", "id", "name", "password", "role") SELECT "active", "createdAt", "email", "id", "name", "password", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "Shift_userId_closedAt_idx" ON "Shift"("userId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceId_key" ON "Order"("invoiceId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channel_externalId_key" ON "Order"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cardUid_key" ON "Customer"("cardUid");

-- CreateIndex
CREATE INDEX "Invoice_shiftId_idx" ON "Invoice"("shiftId");


-- Historical lines had no cost snapshot; backfill with the product's current
-- purchase price so margin reports are meaningful from day one (approximate
-- for old sales — new sales snapshot the real cost at the time of sale).
UPDATE "InvoiceItem" SET "costPrice" = COALESCE((SELECT "purchasePrice" FROM "Product" WHERE "Product"."id" = "InvoiceItem"."productId"), 0);

-- Granular permissions are new: existing cashiers keep every right they had
-- before (discount, returns, stock/catalog edits) so nothing breaks on upgrade.
UPDATE "User" SET "permissions" = 'discount,returns,inventory,customers,orders' WHERE "role" = 'cashier';

-- CreateTable
CREATE TABLE "AppliedTransfer" (
    "transferId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
