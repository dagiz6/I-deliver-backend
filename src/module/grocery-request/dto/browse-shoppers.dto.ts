import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class BrowseShoppersDto {
  @Type(() => Number)
  @IsNumber()
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  longitude: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0.5)
  radiusKm?: number = 10;
}
