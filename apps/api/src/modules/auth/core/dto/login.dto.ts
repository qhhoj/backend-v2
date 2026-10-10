import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** Account username. */
  @IsString() @MinLength(1) @MaxLength(150) username!: string;
  /** Account password. */
  @IsString() @MinLength(1) @MaxLength(4096) password!: string;
}
