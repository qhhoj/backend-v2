import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@libs/auth';
import { isOfficialModeActive, officialModeEndsAt } from '@libs/community';
import { SettingsService } from '@libs/settings';
import { SiteResponse } from './dto/site.response';
import { MiscConfigQuerier } from './misc-config.querier';

@Public()
@ApiTags('Home & site')
@Controller('api/internal/site')
export class SiteController {
  constructor(
    private readonly config: MiscConfigQuerier,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Get the site shell data
   *
   * @remarks
   * Public. Returns what the web app needs on every load: the navigation bar entries (hidden ones included, flagged), the public misc config key/values, and whether official contest mode is on with its end time. Cached privately for 60 seconds.
   */
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
