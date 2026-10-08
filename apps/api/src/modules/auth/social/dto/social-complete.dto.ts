import { PickType } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { RegisterDto } from '../../registration/dto/register.dto';

export class SocialCompleteDto extends PickType(RegisterDto, [
  'username',
  'password',
  'organizationId',
  'languageId',
] as const) {
  @IsString() @Length(1, 512) token!: string;
}
