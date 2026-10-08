import { Controller, Get } from '@nestjs/common';
import { Public } from '@libs/auth';
import { HealthResponse } from './health.response';

@Public()
@Controller('healthz')
export class HealthController {
  @Get() check(): HealthResponse {
    return { status: 'ok' };
  }
}
