import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { WithArcjetRules, shield } from '@arcjet/nest';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import {
  GroceryRealtimeEvent,
  GroceryRequestService,
} from './grocery-request.service';
import {
  BrowseShoppersDto,
  CancelRequestDto,
  CompleteShoppingDto,
  CreateGroceryRequestDto,
  DirectResponseDto,
  DisputeRequestDto,
  ReportOverBudgetDto,
  ResolveOverBudgetDto,
  UpdateShopperStatusDto,
} from './dto';

@Controller('grocery-request')
@WithArcjetRules([shield({ mode: 'LIVE' })])
export class GroceryRequestController {
  constructor(private readonly groceryService: GroceryRequestService) {}

  // ==========================================
  // FR-14: Create Request with Budget Ceiling
  // ==========================================
  @Post()
  async createRequest(
    @Session() session: UserSession,
    @Body() dto: CreateGroceryRequestDto,
  ) {
    return this.groceryService.createRequest(session.user.id, dto);
  }

  // =========================================================
  // FR-15: Browse Available Shoppers within Chosen Radius
  // =========================================================
  @Get('shoppers')
  async browseShoppers(@Query() dto: BrowseShoppersDto) {
    return this.groceryService.browseAvailableShoppers(dto);
  }

  // ============================================================
  // FR-16: Send Direct Request to Specific Available Shopper
  // ============================================================
  @Post(':id/direct')
  async sendDirectRequest(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body('targetShopperId') targetShopperId: string,
  ) {
    if (!targetShopperId) {
      throw new BadRequestException('targetShopperId is required');
    }
    return this.groceryService.sendDirectRequest(
      session.user.id,
      id,
      targetShopperId,
    );
  }

  // ============================================================
  // FR-17: Accept or Decline Direct Request within Window
  // ============================================================
  @Post(':id/direct-response')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async respondToDirectRequest(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: DirectResponseDto,
  ) {
    return this.groceryService.respondToDirectRequest(
      session.user.id,
      id,
      dto,
    );
  }

  // ============================================================
  // Claim an Open Request (FR-14 / FR-17)
  // ============================================================
  @Post(':id/claim')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async claimOpenRequest(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    return this.groceryService.claimOpenRequest(session.user.id, id);
  }

  // ============================================================
  // FR-18: Status Lifecycle Transitions
  // ============================================================
  @Post(':id/start-shopping')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async startShopping(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    return this.groceryService.startShopping(session.user.id, id);
  }

  @Post(':id/depart')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async departForDelivery(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    return this.groceryService.departForDelivery(session.user.id, id);
  }

  @Post(':id/mark-delivered')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async markDelivered(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    return this.groceryService.markDelivered(session.user.id, id);
  }

  // ============================================================
  // FR-19: Over-Budget Reporting (Shopper)
  // ============================================================
  @Post(':id/over-budget')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async reportOverBudget(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: ReportOverBudgetDto,
  ) {
    return this.groceryService.reportOverBudget(session.user.id, id, dto);
  }

  // ============================================================
  // FR-19: Resolve Over-Budget Report (Poster)
  // ============================================================
  @Post(':id/over-budget/resolve')
  async resolveOverBudget(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: ResolveOverBudgetDto,
  ) {
    return this.groceryService.resolveOverBudget(session.user.id, id, dto);
  }

  // ============================================================
  // FR-21: Record Actual Spent & Attach Receipt Photo
  // ============================================================
  @Post(':id/complete-shopping')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  @UseInterceptors(FileInterceptor('receipt'))
  async completeShopping(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: CompleteShoppingDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.groceryService.completeShopping(
      session.user.id,
      id,
      dto,
      file,
    );
  }

  // ============================================================
  // FR-22: Poster Confirms Delivery
  // ============================================================
  @Post(':id/confirm-delivery')
  async confirmDelivery(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    return this.groceryService.confirmDelivery(session.user.id, id);
  }

  // ============================================================
  // FR-23: Cancellation Policy
  // ============================================================
  @Post(':id/cancel')
  async cancelRequest(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: CancelRequestDto,
  ) {
    return this.groceryService.cancelRequest(session.user.id, id, dto);
  }

  // ============================================================
  // FR-24: Disputed Request & Freeze Escrow Funds
  // ============================================================
  @Post(':id/dispute')
  async disputeRequest(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: DisputeRequestDto,
  ) {
    return this.groceryService.disputeRequest(session.user.id, id, dto);
  }

  // ============================================================
  // Live Shopper Availability & Location
  // ============================================================
  @Patch('shopper/status')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async updateShopperStatus(
    @Session() session: UserSession,
    @Body() dto: UpdateShopperStatusDto,
  ) {
    return this.groceryService.updateShopperStatus(session.user.id, dto);
  }

  // ============================================================
  // Real-time Event Stream (FR-19 Real-time updates)
  // ============================================================
  @Sse('events/stream')
  streamEvents(): Observable<{ data: GroceryRealtimeEvent }> {
    return this.groceryService.eventStream$.pipe(
      map((event) => ({ data: event })),
    );
  }

  // ============================================================
  // Queries
  // ============================================================
  @Get('open')
  async getOpenRequests() {
    return this.groceryService.getOpenRequests();
  }

  @Get('my-posted')
  async getMyPostedRequests(@Session() session: UserSession) {
    return this.groceryService.getMyPostedRequests(session.user.id);
  }

  @Get('my-assigned')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async getMyAssignedRequests(@Session() session: UserSession) {
    return this.groceryService.getMyAssignedRequests(session.user.id);
  }

  @Get('my-direct')
  @Roles(['DELIVERY_PARTNER', 'delivery_partner'])
  async getDirectRequestsForShopper(@Session() session: UserSession) {
    return this.groceryService.getDirectRequestsForShopper(session.user.id);
  }

  @Get(':id')
  async getRequestById(
    @Session() session: UserSession,
    @Param('id') id: string,
  ) {
    return this.groceryService.getRequestById(id, session.user.id);
  }
}
