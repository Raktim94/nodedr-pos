-- `discountPercent` is renamed to `discountValue` (now paired with a new
-- `discountType` so it can hold either a percent or a flat-currency
-- discount) — carry over any existing value as a percent-type discount
-- instead of the default drop-and-recreate silently resetting it to 0.
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
    "discountType" TEXT,
    "discountValue" REAL NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("barcode", "category", "createdAt", "hsn", "id", "name", "purchasePrice", "sellingPrice", "stock", "taxRate", "unit", "updatedAt", "discountType", "discountValue")
  SELECT "barcode", "category", "createdAt", "hsn", "id", "name", "purchasePrice", "sellingPrice", "stock", "taxRate", "unit", "updatedAt",
    CASE WHEN "discountPercent" > 0 THEN 'percent' ELSE NULL END,
    "discountPercent"
  FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
