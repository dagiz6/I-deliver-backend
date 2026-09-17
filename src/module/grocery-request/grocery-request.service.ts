import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OverBudgetResolution,
  RequestStatus,
  Role,
} from '@prisma/client';
import { Subject } from 'rxjs';
import { PrismaService } from '../../lib/database/prisma.service';
import { CloudinaryService } from '../../lib/cloudinary/cloudinary.service';
import {
  BrowseShoppersDto,
  CancelRequestDto,
  CompleteShoppingDto,
  CreateGroceryRequestDto,
  DirectResponseAction,
  DirectResponseDto,
  DisputeRequestDto,
  OverBudgetResolutionAction,
  ReportOverBudgetDto,
  ResolveOverBudgetDto,
  UpdateShopperStatusDto,
} from './dto';

export interface GroceryRealtimeEvent {
  requestId: string;
  type: 'OVER_BUDGET_REPORTED' | 'OVER_BUDGET_RESOLVED' | 'STATUS_UPDATED' | 'DIRECT_REQUEST_EXPIRED';
  payload: any;
  timestamp: Date;
}

@Injectable()
export class GroceryRequestService {
  // Real-time event bus for SSE / WebSocket notifications
  public readonly eventStream$ = new Subject<GroceryRealtimeEvent>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Helper to compute distance between two coordinates in kilometers (Haversine formula)
   */
  private calculateDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Helper to log status transition
   */
  private async logStatusChange(
    requestId: string,
    fromStatus: RequestStatus | null,
    toStatus: RequestStatus,
    changedById?: string,
    note?: string,
  ) {
    return this.prisma.requestStatusLog.create({
      data: {
        requestId,
        fromStatus,
        toStatus,
        changedById,
        note,
      },
    });
  }

  // ==========================================
  // FR-14: Create Request with Budget Ceiling
  // ==========================================
  async createRequest(posterId: string, dto: CreateGroceryRequestDto) {
    if (!dto || !dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('At least one grocery item is required in the "items" list');
    }

    const poster = await this.prisma.user.findUnique({
      where: { id: posterId },
    });
    if (!poster) {
      throw new NotFoundException('Poster not found');
    }

    let initialStatus: RequestStatus = RequestStatus.OPEN;
    let targetShopperId: string | undefined = undefined;
    let directRequestExpiresAt: Date | undefined = undefined;

    // Direct Request handling (FR-16)
    if (dto.targetShopperId) {
      const targetShopper = await this.prisma.user.findUnique({
        where: { id: dto.targetShopperId },
      });
      if (!targetShopper) {
        throw new NotFoundException(`Target shopper "${dto.targetShopperId}" not found`);
      }
      if (targetShopper.role !== Role.DELIVERY_PARTNER) {
        throw new BadRequestException('Target user is not a registered delivery partner');
      }
      if (!targetShopper.isAvailableForDelivery) {
        throw new BadRequestException('Target shopper is currently unavailable for delivery');
      }

      initialStatus = RequestStatus.DIRECT_PENDING;
      targetShopperId = targetShopper.id;
      // 10 minutes direct request response window (FR-17)
      directRequestExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    }

    const created = await this.prisma.groceryRequest.create({
      data: {
        posterId,
        budgetCeiling: dto.budgetCeiling,
        originalBudgetCeiling: dto.budgetCeiling,
        deliveryFee: dto.deliveryFee,
        deliveryAddress: dto.deliveryAddress,
        deliveryLatitude: dto.deliveryLatitude,
        deliveryLongitude: dto.deliveryLongitude,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        status: initialStatus,
        targetShopperId,
        directRequestExpiresAt,
        items: {
          create: dto.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            estimatedPrice: item.estimatedPrice,
            notes: item.notes,
          })),
        },
      },
      include: {
        items: true,
        poster: {
          select: { id: true, name: true, image: true, phoneNumber: true },
        },
        targetShopper: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    await this.logStatusChange(
      created.id,
      null,
      initialStatus,
      posterId,
      dto.targetShopperId
        ? `Direct request sent to shopper ${dto.targetShopperId}`
        : 'Open grocery request published',
    );

    return created;
  }

  // =========================================================
  // FR-15: Browse Available Shoppers within Chosen Radius
  // =========================================================
  async browseAvailableShoppers(dto: BrowseShoppersDto) {
    const shoppers = await this.prisma.user.findMany({
      where: {
        role: Role.DELIVERY_PARTNER,
        isAvailableForDelivery: true,
        currentLatitude: { not: null },
        currentLongitude: { not: null },
      },
      select: {
        id: true,
        name: true,
        image: true,
        role: true,
        currentLatitude: true,
        currentLongitude: true,
        lastLocationUpdatedAt: true,
      },
    });

    const radius = dto.radiusKm ?? 10;
    const shoppersWithDistance = await Promise.all(
      shoppers
        .map((shopper) => {
          const distanceKm = this.calculateDistanceKm(
            dto.latitude,
            dto.longitude,
            shopper.currentLatitude!,
            shopper.currentLongitude!,
          );
          return { shopper, distanceKm };
        })
        .filter((item) => item.distanceKm <= radius)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map(async ({ shopper, distanceKm }) => {
          // Attach rating & completed metrics for public profile (FR-15)
          const reviewAggregate = await this.prisma.review.aggregate({
            where: { revieweeId: shopper.id },
            _avg: { rating: true },
            _count: { rating: true },
          });

          const completedDeliveries = await this.prisma.groceryRequest.count({
            where: {
              shopperId: shopper.id,
              status: RequestStatus.COMPLETED,
            },
          });

          return {
            id: shopper.id,
            name: shopper.name,
            image: shopper.image,
            role: shopper.role,
            distanceKm: Number(distanceKm.toFixed(2)),
            lastLocationUpdatedAt: shopper.lastLocationUpdatedAt,
            metrics: {
              averageRating: reviewAggregate._avg.rating || 0,
              totalReviews: reviewAggregate._count.rating || 0,
              completedDeliveries,
            },
          };
        }),
    );

    return shoppersWithDistance;
  }

  // ============================================================
  // FR-16: Send Direct Request to Specific Available Shopper
  // ============================================================
  async sendDirectRequest(posterId: string, requestId: string, targetShopperId: string) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.posterId !== posterId) {
      throw new ForbiddenException('Only the poster can redirect this request');
    }
    if (
      request.status !== RequestStatus.OPEN &&
      request.status !== RequestStatus.DIRECT_PENDING
    ) {
      throw new BadRequestException('Request is no longer open for routing');
    }

    const shopper = await this.prisma.user.findUnique({
      where: { id: targetShopperId },
    });
    if (!shopper || shopper.role !== Role.DELIVERY_PARTNER) {
      throw new BadRequestException('Target shopper not found or not a delivery partner');
    }
    if (!shopper.isAvailableForDelivery) {
      throw new BadRequestException('Target shopper is currently unavailable');
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins window

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.DIRECT_PENDING,
        targetShopperId,
        directRequestExpiresAt: expiresAt,
      },
      include: {
        items: true,
        targetShopper: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    await this.logStatusChange(
      requestId,
      request.status,
      RequestStatus.DIRECT_PENDING,
      posterId,
      `Direct request sent to ${shopper.name} (expires in 10 mins)`,
    );

    return updated;
  }

  // ============================================================
  // FR-17: Accept or Decline Direct Request within Window
  // ============================================================
  async respondToDirectRequest(
    shopperId: string,
    requestId: string,
    dto: DirectResponseDto,
  ) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.targetShopperId !== shopperId) {
      throw new ForbiddenException('You are not the targeted shopper for this direct request');
    }
    if (request.status !== RequestStatus.DIRECT_PENDING) {
      throw new BadRequestException(
        `Cannot respond to direct request with status "${request.status}"`,
      );
    }

    // Check if window has expired
    if (
      request.directRequestExpiresAt &&
      new Date() > request.directRequestExpiresAt
    ) {
      // Revert to open automatically
      await this.prisma.groceryRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.OPEN,
          targetShopperId: null,
          directRequestExpiresAt: null,
        },
      });
      await this.logStatusChange(
        requestId,
        RequestStatus.DIRECT_PENDING,
        RequestStatus.OPEN,
        undefined,
        'Direct response window expired; reverted to open request',
      );
      throw new BadRequestException(
        'The direct request response window has expired. The request is now open to all shoppers.',
      );
    }

    if (dto.action === DirectResponseAction.ACCEPT) {
      const updated = await this.prisma.groceryRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.ACCEPTED,
          shopperId,
          directRequestExpiresAt: null,
        },
        include: { items: true, poster: true, shopper: true },
      });

      await this.logStatusChange(
        requestId,
        RequestStatus.DIRECT_PENDING,
        RequestStatus.ACCEPTED,
        shopperId,
        'Direct request accepted by shopper',
      );

      return updated;
    } else {
      // Declined — Reverts to OPEN for poster to send elsewhere (FR-17)
      const updated = await this.prisma.groceryRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.OPEN,
          targetShopperId: null,
          directRequestExpiresAt: null,
        },
        include: { items: true },
      });

      await this.logStatusChange(
        requestId,
        RequestStatus.DIRECT_PENDING,
        RequestStatus.OPEN,
        shopperId,
        'Direct request declined by shopper; reverted to open',
      );

      return {
        message: 'Direct request declined. Request reverted to OPEN.',
        request: updated,
      };
    }
  }

  // ============================================================
  // Claim an Open Request (FR-14 / FR-17)
  // ============================================================
  async claimOpenRequest(shopperId: string, requestId: string) {
    const shopper = await this.prisma.user.findUnique({
      where: { id: shopperId },
    });
    if (!shopper || shopper.role !== Role.DELIVERY_PARTNER) {
      throw new ForbiddenException('Only delivery partners can claim grocery requests');
    }

    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== RequestStatus.OPEN) {
      throw new BadRequestException('Only OPEN requests can be claimed');
    }

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.ACCEPTED,
        shopperId,
      },
      include: { items: true, poster: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.OPEN,
      RequestStatus.ACCEPTED,
      shopperId,
      'Open request claimed by shopper',
    );

    return updated;
  }

  // ============================================================
  // FR-18: Status Lifecycle Transitions
  // ============================================================
  async startShopping(shopperId: string, requestId: string) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.shopperId !== shopperId) {
      throw new ForbiddenException('Only the assigned shopper can update this request');
    }
    if (request.status !== RequestStatus.ACCEPTED) {
      throw new BadRequestException(`Cannot start shopping from status "${request.status}"`);
    }

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: { status: RequestStatus.SHOPPING },
      include: { items: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.ACCEPTED,
      RequestStatus.SHOPPING,
      shopperId,
      'Shopper began shopping',
    );

    return updated;
  }

  async departForDelivery(shopperId: string, requestId: string) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.shopperId !== shopperId) {
      throw new ForbiddenException('Only the assigned shopper can update this request');
    }
    if (request.status !== RequestStatus.SHOPPING_COMPLETED) {
      throw new BadRequestException('Shopping and receipt recording must be completed first');
    }

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: { status: RequestStatus.IN_TRANSIT },
      include: { items: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.SHOPPING_COMPLETED,
      RequestStatus.IN_TRANSIT,
      shopperId,
      'Shopper is in transit to delivery location',
    );

    return updated;
  }

  async markDelivered(shopperId: string, requestId: string) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.shopperId !== shopperId) {
      throw new ForbiddenException('Only the assigned shopper can mark this delivered');
    }
    if (request.status !== RequestStatus.IN_TRANSIT) {
      throw new BadRequestException('Request must be IN_TRANSIT before marking delivered');
    }

    const now = new Date();
    // 24-hour auto-confirmation timeout (FR-22)
    const autoConfirmAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.DELIVERED,
        deliveredAt: now,
        autoDeliveryConfirmAt: autoConfirmAt,
      },
      include: { items: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.IN_TRANSIT,
      RequestStatus.DELIVERED,
      shopperId,
      'Groceries delivered; pending poster confirmation or 24h auto-completion',
    );

    return updated;
  }

  // ============================================================
  // FR-19: Over-Budget Reporting (While Shopping)
  // ============================================================
  async reportOverBudget(
    shopperId: string,
    requestId: string,
    dto: ReportOverBudgetDto,
  ) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.shopperId !== shopperId) {
      throw new ForbiddenException('Only the assigned shopper can report an over-budget condition');
    }
    if (request.status !== RequestStatus.SHOPPING) {
      throw new BadRequestException('Over-budget reports can only be made while actively shopping');
    }
    if (dto.proposedAmount <= request.budgetCeiling) {
      throw new BadRequestException(
        `Proposed amount (${dto.proposedAmount}) must exceed current budget ceiling (${request.budgetCeiling})`,
      );
    }

    const timeout = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes response timeout (FR-20)

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.OVER_BUDGET_PENDING,
        proposedOverBudgetAmount: dto.proposedAmount,
        overBudgetReason: dto.reason,
        overBudgetExpiresAt: timeout,
        overBudgetResolution: null,
      },
      include: { items: true, poster: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.SHOPPING,
      RequestStatus.OVER_BUDGET_PENDING,
      shopperId,
      `Shopper reported estimated cost of ${dto.proposedAmount} exceeds ceiling ${request.budgetCeiling}. Reason: ${dto.reason}`,
    );

    // Emit real-time notification to Poster (FR-19)
    this.eventStream$.next({
      requestId,
      type: 'OVER_BUDGET_REPORTED',
      payload: {
        posterId: request.posterId,
        currentBudgetCeiling: request.budgetCeiling,
        proposedAmount: dto.proposedAmount,
        reason: dto.reason,
        expiresAt: timeout,
      },
      timestamp: new Date(),
    });

    return updated;
  }

  // ============================================================
  // FR-19: Poster Resolves Over-Budget Report
  // ============================================================
  async resolveOverBudget(
    posterId: string,
    requestId: string,
    dto: ResolveOverBudgetDto,
  ) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
      include: { items: true },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.posterId !== posterId) {
      throw new ForbiddenException('Only the poster can resolve the over-budget condition');
    }
    if (request.status !== RequestStatus.OVER_BUDGET_PENDING) {
      throw new BadRequestException('Request is not in OVER_BUDGET_PENDING status');
    }

    if (dto.action === OverBudgetResolutionAction.APPROVE_INCREASE) {
      const newBudget = request.proposedOverBudgetAmount ?? request.budgetCeiling;

      const updated = await this.prisma.groceryRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.SHOPPING,
          budgetCeiling: newBudget,
          overBudgetResolution: OverBudgetResolution.APPROVED_INCREASE,
          overBudgetExpiresAt: null,
        },
        include: { items: true },
      });

      await this.logStatusChange(
        requestId,
        RequestStatus.OVER_BUDGET_PENDING,
        RequestStatus.SHOPPING,
        posterId,
        `Poster approved budget increase to ${newBudget}`,
      );

      this.eventStream$.next({
        requestId,
        type: 'OVER_BUDGET_RESOLVED',
        payload: {
          shopperId: request.shopperId,
          resolution: OverBudgetResolution.APPROVED_INCREASE,
          newBudgetCeiling: newBudget,
        },
        timestamp: new Date(),
      });

      return updated;
    } else {
      // REMOVE_ITEMS
      if (dto.itemIdsToRemove && dto.itemIdsToRemove.length > 0) {
        await this.prisma.groceryItem.updateMany({
          where: {
            id: { in: dto.itemIdsToRemove },
            requestId,
          },
          data: { isRemoved: true },
        });
      }

      const updated = await this.prisma.groceryRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.SHOPPING,
          overBudgetResolution: OverBudgetResolution.INSTRUCTED_REMOVE_ITEMS,
          overBudgetExpiresAt: null,
        },
        include: { items: true },
      });

      await this.logStatusChange(
        requestId,
        RequestStatus.OVER_BUDGET_PENDING,
        RequestStatus.SHOPPING,
        posterId,
        'Poster instructed shopper to remove selected items and stay within original budget',
      );

      this.eventStream$.next({
        requestId,
        type: 'OVER_BUDGET_RESOLVED',
        payload: {
          shopperId: request.shopperId,
          resolution: OverBudgetResolution.INSTRUCTED_REMOVE_ITEMS,
          budgetCeiling: request.budgetCeiling,
          removedItemIds: dto.itemIdsToRemove || [],
        },
        timestamp: new Date(),
      });

      return updated;
    }
  }

  // ============================================================
  // FR-21: Record Actual Amount Spent & Attach Purchase Receipt
  // ============================================================
  async completeShopping(
    shopperId: string,
    requestId: string,
    dto: CompleteShoppingDto,
    file?: Express.Multer.File,
  ) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.shopperId !== shopperId) {
      throw new ForbiddenException('Only the assigned shopper can complete shopping');
    }
    if (request.status !== RequestStatus.SHOPPING) {
      throw new BadRequestException(`Cannot complete shopping from status "${request.status}"`);
    }
    if (dto.actualSpent > request.budgetCeiling) {
      throw new BadRequestException(
        `Actual spent (${dto.actualSpent}) cannot exceed authorized budget ceiling (${request.budgetCeiling}). If over budget, request an increase first.`,
      );
    }

    let receiptUrl: string | undefined = undefined;
    if (file) {
      const uploadResult = await this.cloudinaryService.uploadFile(
        file,
        'grocery_receipts',
      );
      receiptUrl = uploadResult.secure_url;
    }

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.SHOPPING_COMPLETED,
        actualSpent: dto.actualSpent,
        ...(receiptUrl && { receiptUrl }),
      },
      include: { items: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.SHOPPING,
      RequestStatus.SHOPPING_COMPLETED,
      shopperId,
      `Shopper completed shopping. Actual spent: ${dto.actualSpent}. Receipt attached: ${!!receiptUrl}`,
    );

    return updated;
  }

  // ============================================================
  // FR-22: Poster Confirms Delivery (Completes Request)
  // ============================================================
  async confirmDelivery(posterId: string, requestId: string) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.posterId !== posterId) {
      throw new ForbiddenException('Only the poster can confirm delivery');
    }
    if (request.status !== RequestStatus.DELIVERED) {
      throw new BadRequestException('Request must be in DELIVERED status to confirm');
    }

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.COMPLETED,
        autoDeliveryConfirmAt: null,
      },
      include: { items: true },
    });

    await this.logStatusChange(
      requestId,
      RequestStatus.DELIVERED,
      RequestStatus.COMPLETED,
      posterId,
      'Poster confirmed delivery. Escrow funds released to shopper.',
    );

    return updated;
  }

  // ============================================================
  // FR-23: Cancellation Policy
  // ============================================================
  async cancelRequest(userId: string, requestId: string, dto: CancelRequestDto) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.posterId !== userId && request.shopperId !== userId) {
      throw new ForbiddenException('Only the poster or assigned shopper can cancel this request');
    }

    const isPoster = request.posterId === userId;

    // Cancellation before acceptance (FR-23): 100% refund, no penalty
    if (
      request.status === RequestStatus.OPEN ||
      request.status === RequestStatus.DIRECT_PENDING
    ) {
      const updated = await this.prisma.groceryRequest.update({
        where: { id: requestId },
        data: {
          status: RequestStatus.CANCELLED,
          cancelledById: userId,
          cancellationReason: dto.reason || 'Cancelled before acceptance',
          cancelledAt: new Date(),
        },
      });

      await this.logStatusChange(
        requestId,
        request.status,
        RequestStatus.CANCELLED,
        userId,
        `Request cancelled before acceptance by ${isPoster ? 'Poster' : 'Shopper'}. Full escrow refund issued.`,
      );

      return {
        message: 'Request cancelled with 100% refund.',
        request: updated,
      };
    }

    // Cancellation after acceptance but before shopping starts
    if (request.status === RequestStatus.ACCEPTED) {
      if (isPoster) {
        // Poster cancels after acceptance: Full refund of item ceiling, delivery fee policy applied
        const updated = await this.prisma.groceryRequest.update({
          where: { id: requestId },
          data: {
            status: RequestStatus.CANCELLED,
            cancelledById: userId,
            cancellationReason: dto.reason || 'Poster cancelled after shopper accepted',
            cancelledAt: new Date(),
          },
        });

        await this.logStatusChange(
          requestId,
          RequestStatus.ACCEPTED,
          RequestStatus.CANCELLED,
          userId,
          'Poster cancelled after acceptance. Item budget ceiling refunded.',
        );

        return {
          message: 'Request cancelled after acceptance.',
          request: updated,
        };
      } else {
        // Shopper cancels after acceptance: Request reverts to OPEN so poster can get another shopper
        const updated = await this.prisma.groceryRequest.update({
          where: { id: requestId },
          data: {
            status: RequestStatus.OPEN,
            shopperId: null,
            targetShopperId: null,
          },
        });

        await this.logStatusChange(
          requestId,
          RequestStatus.ACCEPTED,
          RequestStatus.OPEN,
          userId,
          'Shopper withdrew from request before shopping. Request reverted to OPEN.',
        );

        return {
          message: 'Shopper withdrew. Request has reverted to OPEN.',
          request: updated,
        };
      }
    }

    // Cancellation during or after shopping: Restricted because funds/items are committed
    if (
      request.status === RequestStatus.SHOPPING ||
      request.status === RequestStatus.OVER_BUDGET_PENDING ||
      request.status === RequestStatus.SHOPPING_COMPLETED ||
      request.status === RequestStatus.IN_TRANSIT
    ) {
      throw new BadRequestException(
        'Cannot cancel directly while shopping or in transit. Please use the Dispute feature to freeze escrow and request support.',
      );
    }

    throw new BadRequestException(`Cannot cancel request with status "${request.status}"`);
  }

  // ============================================================
  // FR-24: Flag Request as Disputed (Freezes Escrow Funds)
  // ============================================================
  async disputeRequest(userId: string, requestId: string, dto: DisputeRequestDto) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.posterId !== userId && request.shopperId !== userId) {
      throw new ForbiddenException('Only the poster or assigned shopper can dispute this request');
    }
    if (request.status === RequestStatus.COMPLETED) {
      throw new BadRequestException('Completed requests cannot be disputed through this flow');
    }
    if (request.status === RequestStatus.CANCELLED) {
      throw new BadRequestException('Cancelled requests cannot be disputed');
    }

    const updated = await this.prisma.groceryRequest.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.DISPUTED,
        isDisputed: true,
        disputeReason: dto.reason,
        disputedById: userId,
        disputedAt: new Date(),
        escrowFrozen: true, // Freeze escrow funds pending manual review (FR-24)
      },
      include: { items: true },
    });

    await this.logStatusChange(
      requestId,
      request.status,
      RequestStatus.DISPUTED,
      userId,
      `Request flagged as disputed by user ${userId}. Reason: ${dto.reason}. Escrow funds frozen.`,
    );

    return {
      message: 'Request flagged as disputed. Escrow funds are frozen pending manual administrative review.',
      request: updated,
    };
  }

  // ============================================================
  // Shopper Live Availability & Location
  // ============================================================
  async updateShopperStatus(shopperId: string, dto: UpdateShopperStatusDto) {
    const shopper = await this.prisma.user.findUnique({
      where: { id: shopperId },
    });
    if (!shopper || shopper.role !== Role.DELIVERY_PARTNER) {
      throw new ForbiddenException('Only delivery partners can update delivery availability');
    }

    return this.prisma.user.update({
      where: { id: shopperId },
      data: {
        isAvailableForDelivery: dto.isAvailable,
        ...(dto.latitude !== undefined && { currentLatitude: dto.latitude }),
        ...(dto.longitude !== undefined && { currentLongitude: dto.longitude }),
        lastLocationUpdatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        isAvailableForDelivery: true,
        currentLatitude: true,
        currentLongitude: true,
        lastLocationUpdatedAt: true,
      },
    });
  }

  // ============================================================
  // Queries
  // ============================================================
  async getRequestById(requestId: string, currentUserId: string) {
    const request = await this.prisma.groceryRequest.findUnique({
      where: { id: requestId },
      include: {
        items: true,
        poster: {
          select: { id: true, name: true, image: true, phoneNumber: true },
        },
        shopper: {
          select: { id: true, name: true, image: true, phoneNumber: true },
        },
        targetShopper: {
          select: { id: true, name: true, image: true },
        },
        statusLogs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    return request;
  }

  async getOpenRequests() {
    return this.prisma.groceryRequest.findMany({
      where: { status: RequestStatus.OPEN },
      include: {
        items: true,
        poster: {
          select: { id: true, name: true, image: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyPostedRequests(posterId: string) {
    return this.prisma.groceryRequest.findMany({
      where: { posterId },
      include: {
        items: true,
        shopper: {
          select: { id: true, name: true, image: true, phoneNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyAssignedRequests(shopperId: string) {
    return this.prisma.groceryRequest.findMany({
      where: { shopperId },
      include: {
        items: true,
        poster: {
          select: { id: true, name: true, image: true, phoneNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDirectRequestsForShopper(shopperId: string) {
    return this.prisma.groceryRequest.findMany({
      where: {
        targetShopperId: shopperId,
        status: RequestStatus.DIRECT_PENDING,
      },
      include: {
        items: true,
        poster: {
          select: { id: true, name: true, image: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
