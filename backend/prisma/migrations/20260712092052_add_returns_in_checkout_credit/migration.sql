-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" REAL NOT NULL DEFAULT 0,
    "totalDue" REAL NOT NULL DEFAULT 0,
    "creditBalance" REAL NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Customer" ("createdAt", "email", "id", "loyaltyPoints", "name", "phone", "totalDue", "totalSpent", "visits") SELECT "createdAt", "email", "id", "loyaltyPoints", "name", "phone", "totalDue", "totalSpent", "visits" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amountPaid", "changeDue", "createdAt", "customerId", "customerName", "customerPhone", "discountAmount", "discountType", "discountValue", "dueAmount", "id", "invoiceNumber", "loyaltyDiscount", "paymentMethod", "pointsEarned", "pointsRedeemed", "previousDuePaid", "subtotal", "taxAmount", "totalAmount") SELECT "amountPaid", "changeDue", "createdAt", "customerId", "customerName", "customerPhone", "discountAmount", "discountType", "discountValue", "dueAmount", "id", "invoiceNumber", "loyaltyDiscount", "paymentMethod", "pointsEarned", "pointsRedeemed", "previousDuePaid", "subtotal", "taxAmount", "totalAmount" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
