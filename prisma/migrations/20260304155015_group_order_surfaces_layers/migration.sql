-- AlterTable
ALTER TABLE "GroupOrder" ADD COLUMN     "moqSurfaces" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "surfaceMaxLayers" INTEGER;

-- CreateTable
CREATE TABLE "GroupOrderSurface" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupOrderId" TEXT NOT NULL,
    "surfaceIndex" INTEGER NOT NULL,
    "maxLayers" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'open',

    CONSTRAINT "GroupOrderSurface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupOrderLayer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "layerIndex" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "capacityBoxes" INTEGER NOT NULL,
    "capacityUnits" INTEGER NOT NULL,
    "filledBoxes" INTEGER NOT NULL DEFAULT 0,
    "filledUnits" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(32) NOT NULL DEFAULT 'open',
    "contributions" JSONB,

    CONSTRAINT "GroupOrderLayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupOrderSurface_groupOrderId_idx" ON "GroupOrderSurface"("groupOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupOrderSurface_groupOrderId_surfaceIndex_key" ON "GroupOrderSurface"("groupOrderId", "surfaceIndex");

-- CreateIndex
CREATE INDEX "GroupOrderLayer_surfaceId_idx" ON "GroupOrderLayer"("surfaceId");

-- CreateIndex
CREATE INDEX "GroupOrderLayer_productId_idx" ON "GroupOrderLayer"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupOrderLayer_surfaceId_layerIndex_key" ON "GroupOrderLayer"("surfaceId", "layerIndex");

-- AddForeignKey
ALTER TABLE "GroupOrderSurface" ADD CONSTRAINT "GroupOrderSurface_groupOrderId_fkey" FOREIGN KEY ("groupOrderId") REFERENCES "GroupOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupOrderLayer" ADD CONSTRAINT "GroupOrderLayer_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "GroupOrderSurface"("id") ON DELETE CASCADE ON UPDATE CASCADE;
