-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('web', 'whatsapp', 'telegram');

-- CreateEnum
CREATE TYPE "ThreadType" AS ENUM ('browse', 'cart', 'order', 'group_order', 'support', 'suggestion', 'generic');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "IdempotencyScope" AS ENUM ('inbound_message', 'outbound_message', 'payment_intent', 'webhook_event', 'generic');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('hubspot', 'woocommerce', 'whatsapp', 'telegram');

-- CreateEnum
CREATE TYPE "IntegrationAuthType" AS ENUM ('api_key', 'private_app_token', 'oauth2', 'mcp');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(64),
    "preferencesJson" JSONB,
    "profileJson" JSONB,
    "preferredChannel" "Channel",
    "lastSeenChannel" "Channel",
    "lastSeenAt" TIMESTAMP(3),
    "foregroundThreadId" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelIdentity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channelUserId" VARCHAR(256) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "ThreadType" NOT NULL DEFAULT 'generic',
    "key" VARCHAR(256),
    "status" VARCHAR(64),
    "step" VARCHAR(128),
    "contextJson" JSONB,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT NOT NULL,
    "threadId" TEXT,
    "channel" "Channel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "text" TEXT,
    "meta" JSONB,
    "traceId" VARCHAR(64),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" "IdempotencyScope" NOT NULL,
    "key" VARCHAR(256) NOT NULL,
    "customerId" TEXT,
    "responseJson" JSONB,
    "status" VARCHAR(32),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'hubspot',
    "hubspotPortalId" VARCHAR(64),
    "hubspotContactId" VARCHAR(64),
    "hubspotDealId" VARCHAR(64),
    "dealPipelineId" VARCHAR(64),
    "dealStageId" VARCHAR(64),
    "meta" JSONB,

    CONSTRAINT "CrmLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'woocommerce',
    "wooCustomerId" VARCHAR(64),
    "wooCartId" VARCHAR(128),
    "wooOrderId" VARCHAR(64),
    "meta" JSONB,

    CONSTRAINT "CommerceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAccount" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "authType" "IntegrationAuthType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'active',
    "accountId" VARCHAR(128),
    "tokenRef" VARCHAR(256),
    "meta" JSONB,

    CONSTRAINT "IntegrationAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupOrder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "manufacturerId" VARCHAR(128),
    "state" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "constraintsJson" JSONB,
    "moqTarget" INTEGER,
    "moqCurrent" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "GroupOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_foregroundThreadId_key" ON "Customer"("foregroundThreadId");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "ChannelIdentity_customerId_channel_idx" ON "ChannelIdentity"("customerId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_channelUserId_key" ON "ChannelIdentity"("channel", "channelUserId");

-- CreateIndex
CREATE INDEX "Thread_customerId_type_idx" ON "Thread"("customerId", "type");

-- CreateIndex
CREATE INDEX "Thread_customerId_lastActivityAt_idx" ON "Thread"("customerId", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "Thread_customerId_key_key" ON "Thread"("customerId", "key");

-- CreateIndex
CREATE INDEX "Message_customerId_createdAt_idx" ON "Message"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_traceId_idx" ON "Message"("traceId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_customerId_scope_idx" ON "IdempotencyKey"("customerId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON "IdempotencyKey"("scope", "key");

-- CreateIndex
CREATE INDEX "CrmLink_customerId_provider_idx" ON "CrmLink"("customerId", "provider");

-- CreateIndex
CREATE INDEX "CrmLink_hubspotContactId_idx" ON "CrmLink"("hubspotContactId");

-- CreateIndex
CREATE INDEX "CrmLink_hubspotDealId_idx" ON "CrmLink"("hubspotDealId");

-- CreateIndex
CREATE INDEX "CommerceLink_customerId_provider_idx" ON "CommerceLink"("customerId", "provider");

-- CreateIndex
CREATE INDEX "CommerceLink_wooOrderId_idx" ON "CommerceLink"("wooOrderId");

-- CreateIndex
CREATE INDEX "IntegrationAccount_provider_status_idx" ON "IntegrationAccount"("provider", "status");

-- CreateIndex
CREATE INDEX "IntegrationAccount_accountId_idx" ON "IntegrationAccount"("accountId");

-- CreateIndex
CREATE INDEX "GroupOrder_manufacturerId_idx" ON "GroupOrder"("manufacturerId");

-- CreateIndex
CREATE INDEX "GroupOrder_state_idx" ON "GroupOrder"("state");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_foregroundThreadId_fkey" FOREIGN KEY ("foregroundThreadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLink" ADD CONSTRAINT "CrmLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceLink" ADD CONSTRAINT "CommerceLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
