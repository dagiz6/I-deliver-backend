import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AllowAnonymous, Roles, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { WithArcjetRules, shield } from '@arcjet/nest';
import { UserService } from './user.service';
import {
  CreateAddressDto,
  CreatePayoutAccountDto,
  UpdateAddressDto,
  UpdatePayoutAccountDto,
  UpdatePrivateProfileDto,
} from './dto';

@Controller('user')
@WithArcjetRules([shield({ mode: 'LIVE' })])
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('all')
  @Roles(['ADMIN', 'admin'])
  async findAll() {
    return this.userService.findAll();
  }

  @Post('profile-picture')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePicture(
    @Session() session: UserSession,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/i }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.userService.updateProfilePicture(session.user.id, file);
  }

  @Get('me/private-profile')
  async getPrivateProfile(@Session() session: UserSession) {
    return this.userService.getPrivateProfile(session.user.id);
  }

  @Patch('me/private-profile')
  async updatePrivateProfile(
    @Session() session: UserSession,
    @Body() dto: UpdatePrivateProfileDto,
  ) {
    return this.userService.updatePrivateProfile(session.user.id, dto);
  }

  @Get('me/payout-account')
  async getPayoutAccounts(@Session() session: UserSession) {
    return this.userService.getPayoutAccounts(session.user.id);
  }

  @Post('me/payout-account')
  async addPayoutAccount(
    @Session() session: UserSession,
    @Body() dto: CreatePayoutAccountDto,
  ) {
    return this.userService.addPayoutAccount(session.user.id, dto);
  }

  @Put('me/payout-account/:id')
  async updatePayoutAccount(
    @Session() session: UserSession,
    @Param('id') accountId: string,
    @Body() dto: UpdatePayoutAccountDto,
  ) {
    return this.userService.updatePayoutAccount(
      session.user.id,
      accountId,
      dto,
    );
  }

  @Delete('me/payout-account/:id')
  async deletePayoutAccount(
    @Session() session: UserSession,
    @Param('id') accountId: string,
  ) {
    return this.userService.deletePayoutAccount(session.user.id, accountId);
  }

  @Get('me/addresses')
  async getAddresses(@Session() session: UserSession) {
    return this.userService.getAddresses(session.user.id);
  }

  @Post('me/addresses')
  async addAddress(
    @Session() session: UserSession,
    @Body() dto: CreateAddressDto,
  ) {
    return this.userService.addAddress(session.user.id, dto);
  }

  @Put('me/addresses/:id')
  async updateAddress(
    @Session() session: UserSession,
    @Param('id') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.userService.updateAddress(session.user.id, addressId, dto);
  }

  @Delete('me/addresses/:id')
  async deleteAddress(
    @Session() session: UserSession,
    @Param('id') addressId: string,
  ) {
    return this.userService.deleteAddress(session.user.id, addressId);
  }

  @AllowAnonymous()
  @Get('delivery-guy/:id/public-profile')
  async getDeliveryGuyPublicProfile(@Param('id') id: string) {
    return this.userService.getDeliveryGuyPublicProfile(id);
  }

  @AllowAnonymous()
  @Get(':id/public-profile')
  async getPublicProfile(@Param('id') id: string) {
    return this.userService.getPublicProfile(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }
}

