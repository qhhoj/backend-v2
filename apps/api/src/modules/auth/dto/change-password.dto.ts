import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentPasswordDto } from './current-password.dto';

export class ChangePasswordDto extends CurrentPasswordDto {
  @IsString() @MinLength(1) @MaxLength(4096) newPassword!: string;
}
