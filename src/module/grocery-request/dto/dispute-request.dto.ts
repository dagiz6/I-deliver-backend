import { IsNotEmpty, IsString } from 'class-validator';

export class DisputeRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Dispute reason is required' })
  reason: string;
}
