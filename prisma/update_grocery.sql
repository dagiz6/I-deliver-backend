-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'DIRECT_PENDING', 'ACCEPTED', 'SHOPPING', 'OVER_BUDGET_PENDING', 'SHOPPING_COMPLETED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "OverBudgetResolution" AS ENUM ('APPROVED_INCREASE', 'INSTRUCTED_REMOVE_ITEMS', 'AUTO_TIMEOUT_DEFAULT');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "currentLatitude" DOUBLE PRECISION,
ADD COLUMN     "currentLongitude" DOUBLE PRECISION,
ADD COLUMN     "isAvailableForDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastLocationUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "grocery_request" (
    "id" TEXT NOT NULL,
    "posterId" TEXT NOT NULL,
    "shopperId" TEXT,
    "targetShopperId" TEXT,
    "budgetCeiling" DOUBLE PRECISION NOT NULL,
    "originalBudgetCeiling" DOUBLE PRECISION NOT NULL,
    "deliveryFee" DOUBLE PRECISION NOT NULL,
    "actualSpent" DOUBLE PRECISION,
    "receiptUrl" TEXT,
    "deliveryAddress" TEXT NOT NULL,
    "deliveryLatitude" DOUBLE PRECISION NOT NULL,
    "deliveryLongitude" DOUBLE PRECISION NOT NULL,
    "deadline" TIMESTAMP(3),
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "directRequestExpiresAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "autoDeliveryConfirmAt" TIMESTAMP(3),
    "proposedOverBudgetAmount" DOUBLE PRECISION,
    "overBudgetReason" TEXT,
    "overBudgetExpiresAt" TIMESTAMP(3),
    "overBudgetResolution" "OverBudgetResolution",
    "cancellationReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "isDisputed" BOOLEAN NOT NULL DEFAULT false,
    "disputeReason" TEXT,
    "disputedById" TEXT,
    "disputedAt" TIMESTAMP(3),
    "escrowFrozen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grocery_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grocery_item" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "estimatedPrice" DOUBLE PRECISION,
    "notes" TEXT,
    "isRemoved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "grocery_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_log" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus" NOT NULL,
    "changedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "grocery_request" ADD CONSTRAINT "grocery_request_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_request" ADD CONSTRAINT "grocery_request_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_request" ADD CONSTRAINT "grocery_request_targetShopperId_fkey" FOREIGN KEY ("targetShopperId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_item" ADD CONSTRAINT "grocery_item_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "grocery_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_log" ADD CONSTRAINT "request_status_log_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "grocery_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
