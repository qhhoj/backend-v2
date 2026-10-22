import { LowercaseUuid } from '@libs/common';
import { IsUUID } from 'class-validator';

export class KickDto {
  @LowercaseUuid() @IsUUID('7') userId!: string;
}
