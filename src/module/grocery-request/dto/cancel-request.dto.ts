import { IsOptional, IsString } from 'class-validator';

export class CancelRequestDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
