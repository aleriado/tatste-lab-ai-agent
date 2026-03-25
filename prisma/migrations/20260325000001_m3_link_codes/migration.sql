-- M3: Link codes for cross-channel identity bridging
CREATE TABLE "LinkCode" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "customerId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "LinkCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LinkCode_code_key" ON "LinkCode"("code");
CREATE INDEX "LinkCode_code_idx" ON "LinkCode"("code");
CREATE INDEX "LinkCode_customerId_idx" ON "LinkCode"("customerId");
