import { IsEnum, IsNotEmpty } from 'class-validator';

export enum DirectResponseAction {
  ACCEPT = 'ACCEPT',
  DECLINE = 'DECLINE',
}

export class DirectResponseDto {
  @IsEnum(DirectResponseAction, {
    message: 'Action must be either ACCEPT or DECLINE',
  })
  @IsNotEmpty()
  action: DirectResponseAction;
}
