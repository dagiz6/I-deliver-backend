import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class CompleteShoppingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'Actual spent amount must be greater than 0' })
  actualSpent: number;
}
