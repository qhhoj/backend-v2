import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@libs/auth';
import { isOfficialModeActive, officialModeEndsAt } from '@libs/community';
import { SettingsService } from '@libs/settings';
import { SiteResponse } from './dto/site.response';
import { MiscConfigQuerier } from './misc-config.querier';

@Public()
@Controller('api/internal/site')
export class SiteController {
  constructor(
    private readonly config: MiscConfigQuerier,
    private readonly settings: SettingsService,
  ) {}

  /** What the SPA shell needs on every load. `private`: the auth guard may attach a refreshed session cookie to any request, so a shared cache must never store this response. */
  @Header('Cache-Control', 'private, max-age=60')
  @Get()
  site(): SiteResponse {
    return {
      config: this.config.asRecord(),
      officialMode: isOfficialModeActive(this.settings),
      officialModeEndsAt: officialModeEndsAt(this.settings),
    };
  }
}
