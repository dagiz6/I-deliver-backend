import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateGroceryItemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  estimatedPrice?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateGroceryRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGroceryItemDto)
  items: CreateGroceryItemDto[];

  @IsNumber()
  @Min(1, { message: 'Budget ceiling must be greater than 0' })
  budgetCeiling: number;

  @IsNumber()
  @Min(0, { message: 'Delivery fee cannot be negative' })
  deliveryFee: number;

  @IsString()
  @IsNotEmpty()
  deliveryAddress: string;

  @IsNumber()
  deliveryLatitude: number;

  @IsNumber()
  deliveryLongitude: number;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsString()
  @IsOptional()
  targetShopperId?: string;
}
