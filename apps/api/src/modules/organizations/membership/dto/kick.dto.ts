import { IsUUID } from 'class-validator';

export class KickDto {
  @IsUUID('7') userId!: string;
}
