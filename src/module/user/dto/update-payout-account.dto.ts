import { PartialType } from '@nestjs/mapped-types';
import { CreatePayoutAccountDto } from './create-payout-account.dto';

export class UpdatePayoutAccountDto extends PartialType(CreatePayoutAccountDto) {}
