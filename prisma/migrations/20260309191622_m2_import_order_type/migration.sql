-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('GROUP', 'IMPORT');

-- AlterTable
ALTER TABLE "GroupOrder" ADD COLUMN     "isImport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxParticipants" INTEGER,
ADD COLUMN     "orderType" "OrderType" NOT NULL DEFAULT 'GROUP';
