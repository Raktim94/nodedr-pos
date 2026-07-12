-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN "unit" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "unit" TEXT;

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "pincode" TEXT;

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "gstRate" REAL
);

-- CreateTable
CREATE TABLE "PinCode" (
    "pincode" TEXT NOT NULL PRIMARY KEY,
    "area" TEXT,
    "district" TEXT,
    "state" TEXT
);

-- CreateTable
CREATE TABLE "IfscCode" (
    "ifsc" TEXT NOT NULL PRIMARY KEY,
    "bank" TEXT,
    "branch" TEXT,
    "address" TEXT,
    "district" TEXT,
    "state" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_type_code_key" ON "TaxCode"("type", "code");
