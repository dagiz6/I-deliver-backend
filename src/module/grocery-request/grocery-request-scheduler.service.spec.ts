jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_MINUTE: '* * * * *',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { OverBudgetResolution, RequestStatus } from '@prisma/client';
import { PrismaService } from '../../lib/database/prisma.service';
import { GroceryRequestSchedulerService } from './grocery-request-scheduler.service';
import { GroceryRequestService } from './grocery-request.service';

describe('GroceryRequestSchedulerService', () => {
  let scheduler: GroceryRequestSchedulerService;
  let prisma: any;
  let groceryService: any;

  beforeEach(async () => {
    prisma = {
      groceryRequest: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      requestStatusLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    groceryService = {
      eventStream$: {
        next: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroceryRequestSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: GroceryRequestService, useValue: groceryService },
      ],
    }).compile();

    scheduler = module.get<GroceryRequestSchedulerService>(
      GroceryRequestSchedulerService,
    );
  });

  it('FR-17: should automatically revert expired DIRECT_PENDING requests to OPEN', async () => {
    prisma.groceryRequest.findMany.mockResolvedValue([
      { id: 'req-1', posterId: 'user-1', status: RequestStatus.DIRECT_PENDING },
    ]);

    await scheduler.handleExpiredDirectRequests();

    expect(prisma.groceryRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: {
        status: RequestStatus.OPEN,
        targetShopperId: null,
        directRequestExpiresAt: null,
      },
    });
    expect(groceryService.eventStream$.next).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        type: 'DIRECT_REQUEST_EXPIRED',
      }),
    );
  });

  it('FR-20: should default to original budget ceiling when over-budget notification times out', async () => {
    prisma.groceryRequest.findMany.mockResolvedValue([
      {
        id: 'req-2',
        shopperId: 'shopper-1',
        budgetCeiling: 100,
        status: RequestStatus.OVER_BUDGET_PENDING,
      },
    ]);

    await scheduler.handleExpiredOverBudgetTimeouts();

    expect(prisma.groceryRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-2' },
      data: {
        status: RequestStatus.SHOPPING,
        overBudgetResolution: OverBudgetResolution.AUTO_TIMEOUT_DEFAULT,
        overBudgetExpiresAt: null,
      },
    });
    expect(groceryService.eventStream$.next).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-2',
        type: 'OVER_BUDGET_RESOLVED',
        payload: expect.objectContaining({
          resolution: OverBudgetResolution.AUTO_TIMEOUT_DEFAULT,
          budgetCeiling: 100,
        }),
      }),
    );
  });

  it('FR-22: should automatically confirm delivery and complete request after timeout', async () => {
    prisma.groceryRequest.findMany.mockResolvedValue([
      {
        id: 'req-3',
        status: RequestStatus.DELIVERED,
      },
    ]);

    await scheduler.handleAutoDeliveryConfirmations();

    expect(prisma.groceryRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-3' },
      data: {
        status: RequestStatus.COMPLETED,
        autoDeliveryConfirmAt: null,
      },
    });
  });
});
