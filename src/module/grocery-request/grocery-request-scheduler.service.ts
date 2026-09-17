import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OverBudgetResolution, RequestStatus } from '@prisma/client';
import { PrismaService } from '../../lib/database/prisma.service';
import { GroceryRequestService } from './grocery-request.service';

@Injectable()
export class GroceryRequestSchedulerService {
  private readonly logger = new Logger(GroceryRequestSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly groceryRequestService: GroceryRequestService,
  ) {}

  /**
   * Run every minute to check for:
   * 1. Expired direct requests (FR-17)
   * 2. Expired over-budget timeouts (FR-20)
   * 3. Expired auto-delivery confirmation windows (FR-22)
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleLifecycleTimeouts() {
    await this.handleExpiredDirectRequests();
    await this.handleExpiredOverBudgetTimeouts();
    await this.handleAutoDeliveryConfirmations();
  }

  /**
   * FR-17: If the targeted Shopper doesn't accept within the window,
   * the request reverts to OPEN for the Poster to send elsewhere or for any shopper to claim.
   */
  async handleExpiredDirectRequests() {
    const now = new Date();
    const expiredRequests = await this.prisma.groceryRequest.findMany({
      where: {
        status: RequestStatus.DIRECT_PENDING,
        directRequestExpiresAt: {
          lte: now,
        },
      },
    });

    for (const req of expiredRequests) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.groceryRequest.update({
            where: { id: req.id },
            data: {
              status: RequestStatus.OPEN,
              targetShopperId: null,
              directRequestExpiresAt: null,
            },
          });

          await tx.requestStatusLog.create({
            data: {
              requestId: req.id,
              fromStatus: RequestStatus.DIRECT_PENDING,
              toStatus: RequestStatus.OPEN,
              note: 'Direct request response window expired; automatically reverted to OPEN',
            },
          });
        });

        this.groceryRequestService.eventStream$.next({
          requestId: req.id,
          type: 'DIRECT_REQUEST_EXPIRED',
          payload: { posterId: req.posterId },
          timestamp: new Date(),
        });

        this.logger.log(`Direct request ${req.id} reverted to OPEN after response window expiry.`);
      } catch (err) {
        this.logger.error(`Failed to revert direct request ${req.id}:`, err);
      }
    }
  }

  /**
   * FR-20: If Poster does not respond to an over-budget notification within defined timeout,
   * default to instructing Shopper to complete purchase within original held ceiling.
   */
  async handleExpiredOverBudgetTimeouts() {
    const now = new Date();
    const expiredOverBudget = await this.prisma.groceryRequest.findMany({
      where: {
        status: RequestStatus.OVER_BUDGET_PENDING,
        overBudgetExpiresAt: {
          lte: now,
        },
      },
    });

    for (const req of expiredOverBudget) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.groceryRequest.update({
            where: { id: req.id },
            data: {
              status: RequestStatus.SHOPPING,
              overBudgetResolution: OverBudgetResolution.AUTO_TIMEOUT_DEFAULT,
              overBudgetExpiresAt: null,
            },
          });

          await tx.requestStatusLog.create({
            data: {
              requestId: req.id,
              fromStatus: RequestStatus.OVER_BUDGET_PENDING,
              toStatus: RequestStatus.SHOPPING,
              note: 'Poster timed out responding to over-budget alert; defaulted to completing within original ceiling only',
            },
          });
        });

        this.groceryRequestService.eventStream$.next({
          requestId: req.id,
          type: 'OVER_BUDGET_RESOLVED',
          payload: {
            shopperId: req.shopperId,
            resolution: OverBudgetResolution.AUTO_TIMEOUT_DEFAULT,
            budgetCeiling: req.budgetCeiling,
          },
          timestamp: new Date(),
        });

        this.logger.log(`Request ${req.id} over-budget timed out; defaulted to original budget ceiling.`);
      } catch (err) {
        this.logger.error(`Failed to handle over-budget timeout for ${req.id}:`, err);
      }
    }
  }

  /**
   * FR-22: Automatically mark delivered/completed after defined timeout (e.g. 24h)
   * if Poster takes no action.
   */
  async handleAutoDeliveryConfirmations() {
    const now = new Date();
    const expiredDeliveries = await this.prisma.groceryRequest.findMany({
      where: {
        status: RequestStatus.DELIVERED,
        autoDeliveryConfirmAt: {
          lte: now,
        },
        isDisputed: false,
      },
    });

    for (const req of expiredDeliveries) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.groceryRequest.update({
            where: { id: req.id },
            data: {
              status: RequestStatus.COMPLETED,
              autoDeliveryConfirmAt: null,
            },
          });

          await tx.requestStatusLog.create({
            data: {
              requestId: req.id,
              fromStatus: RequestStatus.DELIVERED,
              toStatus: RequestStatus.COMPLETED,
              note: 'Delivery auto-confirmed after 24-hour timeout without poster dispute or action',
            },
          });
        });

        this.groceryRequestService.eventStream$.next({
          requestId: req.id,
          type: 'STATUS_UPDATED',
          payload: { status: RequestStatus.COMPLETED },
          timestamp: new Date(),
        });

        this.logger.log(`Request ${req.id} automatically completed after 24h delivery confirmation timeout.`);
      } catch (err) {
        this.logger.error(`Failed to auto-confirm delivery for ${req.id}:`, err);
      }
    }
  }
}
