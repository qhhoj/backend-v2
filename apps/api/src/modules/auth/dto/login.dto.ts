import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(150) username!: string;
  @IsString() @MinLength(1) @MaxLength(4096) password!: string;
}
