import { Controller, Get } from '@nestjs/common';
import { Public } from '@libs/auth';

@Public()
@Controller('healthz')
export class HealthController {
  @Get() check() {
    return { status: 'ok' };
  }
}
