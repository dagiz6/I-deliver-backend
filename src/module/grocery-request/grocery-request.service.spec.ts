import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OverBudgetResolution, RequestStatus, Role } from '@prisma/client';
import { PrismaService } from '../../lib/database/prisma.service';
import { CloudinaryService } from '../../lib/cloudinary/cloudinary.service';
import { GroceryRequestService } from './grocery-request.service';
import { DirectResponseAction, OverBudgetResolutionAction } from './dto';

describe('GroceryRequestService', () => {
  let service: GroceryRequestService;
  let prisma: any;
  let cloudinary: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      groceryRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      groceryItem: {
        updateMany: jest.fn(),
      },
      requestStatusLog: {
        create: jest.fn(),
      },
      review: {
        aggregate: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    cloudinary = {
      uploadFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroceryRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloudinaryService, useValue: cloudinary },
      ],
    }).compile();

    service = module.get<GroceryRequestService>(GroceryRequestService);
  });

  describe('FR-14: createRequest', () => {
    it('should create an open grocery request with budget ceiling and item list', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: Role.CUSTOMER });
      prisma.groceryRequest.create.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        budgetCeiling: 100,
        originalBudgetCeiling: 100,
        deliveryFee: 15,
        deliveryAddress: 'Bole, Addis Ababa',
        deliveryLatitude: 9.01,
        deliveryLongitude: 38.75,
        status: RequestStatus.OPEN,
        items: [{ id: 'item-1', name: 'Milk', quantity: 2 }],
      });

      const result = await service.createRequest('user-1', {
        items: [{ name: 'Milk', quantity: 2 }],
        budgetCeiling: 100,
        deliveryFee: 15,
        deliveryAddress: 'Bole, Addis Ababa',
        deliveryLatitude: 9.01,
        deliveryLongitude: 38.75,
      });

      expect(result.status).toBe(RequestStatus.OPEN);
      expect(result.budgetCeiling).toBe(100);
      expect(prisma.requestStatusLog.create).toHaveBeenCalled();
    });

    it('should create DIRECT_PENDING request when targetShopperId is provided (FR-16)', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user-1', role: Role.CUSTOMER })
        .mockResolvedValueOnce({
          id: 'shopper-1',
          role: Role.DELIVERY_PARTNER,
          isAvailableForDelivery: true,
        });

      prisma.groceryRequest.create.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        targetShopperId: 'shopper-1',
        status: RequestStatus.DIRECT_PENDING,
        items: [],
      });

      const result = await service.createRequest('user-1', {
        items: [{ name: 'Bread', quantity: 1 }],
        budgetCeiling: 50,
        deliveryFee: 10,
        deliveryAddress: 'Piassa',
        deliveryLatitude: 9.03,
        deliveryLongitude: 38.74,
        targetShopperId: 'shopper-1',
      });

      expect(result.status).toBe(RequestStatus.DIRECT_PENDING);
      expect(prisma.groceryRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RequestStatus.DIRECT_PENDING,
            targetShopperId: 'shopper-1',
          }),
        }),
      );
    });
  });

  describe('FR-15: browseAvailableShoppers', () => {
    it('should filter shoppers within given radius and return profile metrics', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'shopper-1',
          name: 'Abebe Delivery',
          image: null,
          role: Role.DELIVERY_PARTNER,
          currentLatitude: 9.02,
          currentLongitude: 38.76,
          lastLocationUpdatedAt: new Date(),
        },
        {
          id: 'shopper-far',
          name: 'Far Away',
          image: null,
          role: Role.DELIVERY_PARTNER,
          currentLatitude: 11.5,
          currentLongitude: 40.0,
          lastLocationUpdatedAt: new Date(),
        },
      ]);
      prisma.review.aggregate.mockResolvedValue({
        _avg: { rating: 4.8 },
        _count: { rating: 25 },
      });
      prisma.groceryRequest.count.mockResolvedValue(30);

      const shoppers = await service.browseAvailableShoppers({
        latitude: 9.01,
        longitude: 38.75,
        radiusKm: 10,
      });

      expect(shoppers.length).toBe(1);
      expect(shoppers[0].id).toBe('shopper-1');
      expect(shoppers[0].metrics.averageRating).toBe(4.8);
      expect(shoppers[0].metrics.completedDeliveries).toBe(30);
    });
  });

  describe('FR-17: respondToDirectRequest', () => {
    it('should allow target shopper to accept within window', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        targetShopperId: 'shopper-1',
        status: RequestStatus.DIRECT_PENDING,
        directRequestExpiresAt: new Date(Date.now() + 500000),
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.ACCEPTED,
        shopperId: 'shopper-1',
      });

      const result = await service.respondToDirectRequest('shopper-1', 'req-1', {
        action: DirectResponseAction.ACCEPT,
      });

      expect(result.status).toBe(RequestStatus.ACCEPTED);
      expect(prisma.groceryRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RequestStatus.ACCEPTED,
            shopperId: 'shopper-1',
          }),
        }),
      );
    });

    it('should revert to OPEN when declined', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        targetShopperId: 'shopper-1',
        status: RequestStatus.DIRECT_PENDING,
        directRequestExpiresAt: new Date(Date.now() + 500000),
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.OPEN,
        targetShopperId: null,
      });

      const result = await service.respondToDirectRequest('shopper-1', 'req-1', {
        action: DirectResponseAction.DECLINE,
      });

      expect(result.request.status).toBe(RequestStatus.OPEN);
    });

    it('should revert to OPEN and throw error if response window has expired', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        targetShopperId: 'shopper-1',
        status: RequestStatus.DIRECT_PENDING,
        directRequestExpiresAt: new Date(Date.now() - 1000), // Expired
      });

      await expect(
        service.respondToDirectRequest('shopper-1', 'req-1', {
          action: DirectResponseAction.ACCEPT,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.groceryRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RequestStatus.OPEN,
          }),
        }),
      );
    });
  });

  describe('FR-19 & FR-20: Over-budget reporting & resolution', () => {
    it('should allow shopper to report over-budget and notify poster', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        shopperId: 'shopper-1',
        posterId: 'user-1',
        budgetCeiling: 100,
        status: RequestStatus.SHOPPING,
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.OVER_BUDGET_PENDING,
        proposedOverBudgetAmount: 130,
        overBudgetReason: 'Milk price increased',
      });

      const res = await service.reportOverBudget('shopper-1', 'req-1', {
        proposedAmount: 130,
        reason: 'Milk price increased',
      });

      expect(res.status).toBe(RequestStatus.OVER_BUDGET_PENDING);
      expect(prisma.groceryRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RequestStatus.OVER_BUDGET_PENDING,
            proposedOverBudgetAmount: 130,
          }),
        }),
      );
    });

    it('should allow poster to approve budget increase', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        shopperId: 'shopper-1',
        budgetCeiling: 100,
        proposedOverBudgetAmount: 130,
        status: RequestStatus.OVER_BUDGET_PENDING,
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        budgetCeiling: 130,
        status: RequestStatus.SHOPPING,
        overBudgetResolution: OverBudgetResolution.APPROVED_INCREASE,
      });

      const res = await service.resolveOverBudget('user-1', 'req-1', {
        action: OverBudgetResolutionAction.APPROVE_INCREASE,
      });

      expect(res.status).toBe(RequestStatus.SHOPPING);
      expect(res.budgetCeiling).toBe(130);
    });

    it('should allow poster to instruct removing items', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        shopperId: 'shopper-1',
        budgetCeiling: 100,
        proposedOverBudgetAmount: 130,
        status: RequestStatus.OVER_BUDGET_PENDING,
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.SHOPPING,
        overBudgetResolution: OverBudgetResolution.INSTRUCTED_REMOVE_ITEMS,
      });

      const res = await service.resolveOverBudget('user-1', 'req-1', {
        action: OverBudgetResolutionAction.REMOVE_ITEMS,
        itemIdsToRemove: ['item-2'],
      });

      expect(res.status).toBe(RequestStatus.SHOPPING);
      expect(prisma.groceryItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['item-2'] }, requestId: 'req-1' },
        data: { isRemoved: true },
      });
    });
  });

  describe('FR-21: completeShopping with receipt upload', () => {
    it('should record actual spent and upload receipt photo', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        shopperId: 'shopper-1',
        budgetCeiling: 100,
        status: RequestStatus.SHOPPING,
      });
      cloudinary.uploadFile.mockResolvedValue({ secure_url: 'https://cloudinary.com/receipt.jpg' });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.SHOPPING_COMPLETED,
        actualSpent: 92.5,
        receiptUrl: 'https://cloudinary.com/receipt.jpg',
      });

      const dummyFile = { buffer: Buffer.from('img') } as Express.Multer.File;
      const res = await service.completeShopping('shopper-1', 'req-1', { actualSpent: 92.5 }, dummyFile);

      expect(res.actualSpent).toBe(92.5);
      expect(res.receiptUrl).toBe('https://cloudinary.com/receipt.jpg');
      expect(res.status).toBe(RequestStatus.SHOPPING_COMPLETED);
    });

    it('should reject if actual spent exceeds authorized ceiling without prior approval', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        shopperId: 'shopper-1',
        budgetCeiling: 100,
        status: RequestStatus.SHOPPING,
      });

      await expect(
        service.completeShopping('shopper-1', 'req-1', { actualSpent: 120 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('FR-22: confirmDelivery', () => {
    it('should allow poster to confirm delivery and complete request', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        status: RequestStatus.DELIVERED,
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.COMPLETED,
      });

      const res = await service.confirmDelivery('user-1', 'req-1');
      expect(res.status).toBe(RequestStatus.COMPLETED);
    });
  });

  describe('FR-23: Cancellation policy', () => {
    it('should allow 100% refund when cancelled before acceptance', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        status: RequestStatus.OPEN,
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.CANCELLED,
      });

      const res = await service.cancelRequest('user-1', 'req-1', { reason: 'No longer needed' });
      expect(res.message).toContain('100% refund');
      expect(res.request.status).toBe(RequestStatus.CANCELLED);
    });

    it('should prevent direct cancellation during shopping without dispute', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        status: RequestStatus.SHOPPING,
      });

      await expect(
        service.cancelRequest('user-1', 'req-1', { reason: 'Changed mind' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('FR-24: disputeRequest & escrow freeze', () => {
    it('should flag request as disputed and freeze escrow funds', async () => {
      prisma.groceryRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        posterId: 'user-1',
        shopperId: 'shopper-1',
        status: RequestStatus.SHOPPING,
      });
      prisma.groceryRequest.update.mockResolvedValue({
        id: 'req-1',
        status: RequestStatus.DISPUTED,
        isDisputed: true,
        escrowFrozen: true,
      });

      const res = await service.disputeRequest('user-1', 'req-1', {
        reason: 'Shopper purchased wrong items and refused to communicate',
      });

      expect(res.message).toContain('frozen');
      expect(res.request.isDisputed).toBe(true);
      expect(res.request.escrowFrozen).toBe(true);
      expect(prisma.groceryRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RequestStatus.DISPUTED,
            isDisputed: true,
            escrowFrozen: true,
          }),
        }),
      );
    });
  });
});
