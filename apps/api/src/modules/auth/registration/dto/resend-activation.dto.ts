import { PickType } from '@nestjs/swagger';
import { RegisterDto } from './register.dto';

export class ResendActivationDto extends PickType(RegisterDto, [
  'email',
] as const) {}
