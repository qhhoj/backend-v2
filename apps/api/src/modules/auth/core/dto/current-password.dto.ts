import { IsString, MaxLength, MinLength } from 'class-validator';

export class CurrentPasswordDto {
  /** The account password, re-entered to confirm the change. */
  @IsString() @MinLength(1) @MaxLength(4096) currentPassword!: string;
}
