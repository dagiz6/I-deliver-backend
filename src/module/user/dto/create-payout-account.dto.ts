import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PayoutAccountType } from '@prisma/client';

export class CreatePayoutAccountDto {
  @IsEnum(PayoutAccountType)
  @IsNotEmpty()
  accountType: PayoutAccountType;

  @IsString()
  @IsNotEmpty()
  provider: string;

  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
