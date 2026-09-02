import { IsOptional, IsString } from 'class-validator';

export class UpdatePrivateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
