import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';
import { PrismaService } from '../../lib/database/prisma.service';
import { CloudinaryService } from '../../lib/cloudinary/cloudinary.service';
import {
  CreateAddressDto,
  CreatePayoutAccountDto,
  UpdateAddressDto,
  UpdatePayoutAccountDto,
  UpdatePrivateProfileDto,
} from './dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  async updateProfilePicture(userId: string, file: Express.Multer.File) {
    // Check if user exists
    await this.findOne(userId);

    // Upload file to Cloudinary
    const uploadResult = await this.cloudinaryService.uploadFile(
      file,
      'profile_pictures',
    );

    // Update user record with secure_url
    return this.prisma.user.update({
      where: { id: userId },
      data: { image: uploadResult.secure_url },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    const reviewAggregate = await this.prisma.review.aggregate({
      where: { revieweeId: userId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const completedDeliveries = await this.prisma.order.count({
      where: {
        deliveryPartnerId: userId,
        status: OrderStatus.COMPLETED,
      },
    });

    const completedOrders = await this.prisma.order.count({
      where: {
        customerId: userId,
        status: OrderStatus.COMPLETED,
      },
    });

    return {
      ...user,
      rating: {
        average: reviewAggregate._avg.rating || 0,
        count: reviewAggregate._count.rating || 0,
      },
      completedDeliveries,
      completedOrders,
    };
  }

  async getDeliveryGuyPublicProfile(shopperId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: shopperId },
      select: {
        id: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${shopperId}" not found`);
    }

    if (user.role !== Role.DELIVERY_PARTNER) {
      throw new BadRequestException(
        `User with ID "${shopperId}" is not a delivery partner`,
      );
    }

    const reviewAggregate = await this.prisma.review.aggregate({
      where: { revieweeId: shopperId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const completedDeliveries = await this.prisma.order.count({
      where: {
        deliveryPartnerId: shopperId,
        status: OrderStatus.COMPLETED,
      },
    });

    const reviews = await this.prisma.review.findMany({
      where: { revieweeId: shopperId },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        reviewer: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      ...user,
      metrics: {
        averageRating: reviewAggregate._avg.rating || 0,
        totalReviews: reviewAggregate._count.rating || 0,
        completedDeliveries,
      },
      reviews,
    };
  }

  async getPrivateProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        image: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        addresses: true,
        payoutAccounts: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    return user;
  }

  async updatePrivateProfile(userId: string, dto: UpdatePrivateProfileDto) {
    await this.findOne(userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        image: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // --- Payout Account CRUD ---

  async addPayoutAccount(userId: string, dto: CreatePayoutAccountDto) {
    await this.findOne(userId);

    if (dto.isPrimary) {
      await this.prisma.payoutAccount.updateMany({
        where: { userId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.payoutAccount.create({
      data: {
        userId,
        accountType: dto.accountType,
        provider: dto.provider,
        accountName: dto.accountName,
        accountNumber: dto.accountNumber,
        isPrimary: dto.isPrimary ?? true,
      },
    });
  }

  async getPayoutAccounts(userId: string) {
    await this.findOne(userId);

    return this.prisma.payoutAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updatePayoutAccount(
    userId: string,
    accountId: string,
    dto: UpdatePayoutAccountDto,
  ) {
    const account = await this.prisma.payoutAccount.findFirst({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException(
        `Payout account with ID "${accountId}" not found`,
      );
    }

    if (dto.isPrimary) {
      await this.prisma.payoutAccount.updateMany({
        where: { userId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.payoutAccount.update({
      where: { id: accountId },
      data: dto,
    });
  }

  async deletePayoutAccount(userId: string, accountId: string) {
    const account = await this.prisma.payoutAccount.findFirst({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException(
        `Payout account with ID "${accountId}" not found`,
      );
    }

    return this.prisma.payoutAccount.delete({
      where: { id: accountId },
    });
  }

  // --- Saved Address CRUD ---

  async addAddress(userId: string, dto: CreateAddressDto) {
    await this.findOne(userId);

    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    return this.prisma.address.create({
      data: {
        userId,
        ...dto,
      },
    });
  }

  async getAddresses(userId: string) {
    await this.findOne(userId);

    return this.prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException(
        `Address with ID "${addressId}" not found`,
      );
    }

    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    return this.prisma.address.update({
      where: { id: addressId },
      data: dto,
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException(
        `Address with ID "${addressId}" not found`,
      );
    }

    return this.prisma.address.delete({
      where: { id: addressId },
    });
  }
}

