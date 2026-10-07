-- externalId was unique per channel across ALL API keys: one key could read
-- another key's order back (dedup) or squat its future ids. Scope it per sender.
ALTER TABLE "Order" ADD COLUMN "dedupScope" TEXT NOT NULL DEFAULT '';
UPDATE "Order" SET "dedupScope" = 'key:' || "apiKeyId" WHERE "apiKeyId" IS NOT NULL;
UPDATE "Order" SET "dedupScope" = 'store:' || "integrationId" WHERE "apiKeyId" IS NULL AND "integrationId" IS NOT NULL;
DROP INDEX "Order_channel_externalId_key";
CREATE UNIQUE INDEX "Order_channel_dedupScope_externalId_key" ON "Order"("channel", "dedupScope", "externalId");
