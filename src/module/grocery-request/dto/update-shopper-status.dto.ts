import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class UpdateShopperStatusDto {
  @IsBoolean()
  isAvailable: boolean;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;
}
