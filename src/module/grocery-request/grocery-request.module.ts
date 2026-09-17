import { Module } from '@nestjs/common';
import { GroceryRequestController } from './grocery-request.controller';
import { GroceryRequestService } from './grocery-request.service';
import { GroceryRequestSchedulerService } from './grocery-request-scheduler.service';

@Module({
  controllers: [GroceryRequestController],
  providers: [GroceryRequestService, GroceryRequestSchedulerService],
  exports: [GroceryRequestService],
})
export class GroceryRequestModule {}
