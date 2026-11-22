-- A card-terminal payment can pay for exactly one bill. The application checks
-- first; this makes two concurrent checkouts unable to both commit.
CREATE UNIQUE INDEX "Invoice_paymentRef_key" ON "Invoice"("paymentRef");
