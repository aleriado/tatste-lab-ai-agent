/*
  Warnings:

  - You are about to drop the column `state` on the `GroupOrder` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `GroupOrder` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `code` to the `GroupOrder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdByCustomerId` to the `GroupOrder` table without a default value. This is not possible if the table is not empty.
  - Made the column `moqTarget` on table `GroupOrder` required. This step will fail if there are existing NULL values in that column.
  - Made the column `moqCurrent` on table `GroupOrder` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "GroupOrderStatus" AS ENUM ('DRAFT', 'OPEN', 'MOQ_REACHED', 'EXPIRED', 'CHECKOUT_STARTED', 'CONFIRMED');

-- DropIndex
DROP INDEX "GroupOrder_state_idx";

-- AlterTable
ALTER TABLE "GroupOrder" DROP COLUMN "state",
ADD COLUMN     "code" VARCHAR(8) NOT NULL,
ADD COLUMN     "createdByCustomerId" TEXT NOT NULL,
ADD COLUMN     "status" "GroupOrderStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "moqTarget" SET NOT NULL,
ALTER COLUMN "moqTarget" SET DEFAULT 1,
ALTER COLUMN "moqCurrent" SET NOT NULL,
ALTER COLUMN "moqCurrent" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "GroupOrderParticipant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "GroupOrderParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupOrderItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "GroupOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "groupOrderId" TEXT,
    "token" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "amountDueNow" DECIMAL(10,2) NOT NULL,
    "amountDueLater" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "meta" JSONB,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupOrderParticipant_groupOrderId_idx" ON "GroupOrderParticipant"("groupOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupOrderParticipant_groupOrderId_customerId_key" ON "GroupOrderParticipant"("groupOrderId", "customerId");

-- CreateIndex
CREATE INDEX "GroupOrderItem_groupOrderId_idx" ON "GroupOrderItem"("groupOrderId");

-- CreateIndex
CREATE INDEX "GroupOrderItem_groupOrderId_customerId_idx" ON "GroupOrderItem"("groupOrderId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_customerId_key" ON "Cart"("customerId");

-- CreateIndex
CREATE INDEX "Cart_customerId_idx" ON "Cart"("customerId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_variantId_key" ON "CartItem"("cartId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_token_key" ON "CheckoutSession"("token");

-- CreateIndex
CREATE INDEX "CheckoutSession_customerId_idx" ON "CheckoutSession"("customerId");

-- CreateIndex
CREATE INDEX "CheckoutSession_token_idx" ON "CheckoutSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "GroupOrder_code_key" ON "GroupOrder"("code");

-- CreateIndex
CREATE INDEX "GroupOrder_status_idx" ON "GroupOrder"("status");

-- CreateIndex
CREATE INDEX "GroupOrder_code_idx" ON "GroupOrder"("code");

-- AddForeignKey
ALTER TABLE "GroupOrder" ADD CONSTRAINT "GroupOrder_createdByCustomerId_fkey" FOREIGN KEY ("createdByCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOrderParticipant" ADD CONSTRAINT "GroupOrderParticipant_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOrderParticipant" ADD CONSTRAINT "GroupOrderParticipant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOrderItem" ADD CONSTRAINT "GroupOrderItem_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
