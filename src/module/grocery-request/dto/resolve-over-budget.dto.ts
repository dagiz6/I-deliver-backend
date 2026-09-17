import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum OverBudgetResolutionAction {
  APPROVE_INCREASE = 'APPROVE_INCREASE',
  REMOVE_ITEMS = 'REMOVE_ITEMS',
}

export class ResolveOverBudgetDto {
  @IsEnum(OverBudgetResolutionAction, {
    message: 'Action must be APPROVE_INCREASE or REMOVE_ITEMS',
  })
  @IsNotEmpty()
  action: OverBudgetResolutionAction;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  itemIdsToRemove?: string[];
}
