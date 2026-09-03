-- AlterTable
ALTER TABLE "integration_connections" ADD COLUMN     "credentials_encrypted" TEXT,
ADD COLUMN     "external_account" TEXT,
ADD COLUMN     "last_error_at" TIMESTAMPTZ(3),
ADD COLUMN     "token_expires_at" TIMESTAMPTZ(3);
