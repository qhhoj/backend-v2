import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@libs/auth';
import { RuntimesResponse } from './dto/runtimes.response';
import { RuntimesService } from './runtimes.service';

@ApiTags('Submissions')
@Controller('api/internal/runtimes')
export class RuntimesController {
  constructor(private readonly runtimes: RuntimesService) {}

  /**
   * Get the judges and the languages they run
   *
   * @remarks
   * Public. Returns the judges that may connect (blocked and disabled ones are
   * left out) with online state, slots, slots in use, mean ping in milliseconds
   * and when they started, and every programming language with the compiler
   * version each judge has for it. Keys, addresses, builds and notes are never
   * returned.
   */
  @Public()
  @Get()
  overview(): Promise<RuntimesResponse> {
    return this.runtimes.overview();
  }
}
