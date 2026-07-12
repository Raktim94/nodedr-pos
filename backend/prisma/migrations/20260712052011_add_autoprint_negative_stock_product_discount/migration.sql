-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "hsn" TEXT,
    "unit" TEXT,
    "purchasePrice" REAL NOT NULL,
    "sellingPrice" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("barcode", "category", "createdAt", "hsn", "id", "name", "purchasePrice", "sellingPrice", "stock", "taxRate", "unit", "updatedAt") SELECT "barcode", "category", "createdAt", "hsn", "id", "name", "purchasePrice", "sellingPrice", "stock", "taxRate", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
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
    "lowStockAlert" INTEGER NOT NULL DEFAULT 5,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "pincode" TEXT
);
INSERT INTO "new_ShopSettings" ("address1", "address2", "city", "currencyCode", "currencySymbol", "defaultTaxRate", "email", "gstEnabled", "gstNumber", "id", "legalName", "lowStockAlert", "loyaltyEnabled", "panNumber", "phone", "pincode", "pointValue", "pointsPerUnit", "receiptFooter", "receiptHeader", "shopName", "showGst", "state") SELECT "address1", "address2", "city", "currencyCode", "currencySymbol", "defaultTaxRate", "email", "gstEnabled", "gstNumber", "id", "legalName", "lowStockAlert", "loyaltyEnabled", "panNumber", "phone", "pincode", "pointValue", "pointsPerUnit", "receiptFooter", "receiptHeader", "shopName", "showGst", "state" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
