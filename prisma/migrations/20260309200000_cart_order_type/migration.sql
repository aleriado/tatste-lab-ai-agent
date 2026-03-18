-- CreateEnum
CREATE TYPE "CartOrderType" AS ENUM ('REGULAR', 'STOCK');

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN "orderType" "CartOrderType" NOT NULL DEFAULT 'REGULAR';

-- DropIndex
DROP INDEX "CartItem_cartId_productId_variantId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_productId_variantId_orderType_key" ON "CartItem"("cartId", "productId", "variantId", "orderType");
