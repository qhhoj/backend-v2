import { PickType } from '@nestjs/swagger';
import { RegisterDto } from './register.dto';

export class UsernameAvailableDto extends PickType(RegisterDto, [
  'username',
] as const) {}
