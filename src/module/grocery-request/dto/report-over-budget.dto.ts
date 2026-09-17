import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class ReportOverBudgetDto {
  @IsNumber()
  @Min(0.01, { message: 'Proposed amount must be positive' })
  proposedAmount: number;

  @IsString()
  @IsNotEmpty({ message: 'A reason for exceeding the budget is required' })
  reason: string;
}
