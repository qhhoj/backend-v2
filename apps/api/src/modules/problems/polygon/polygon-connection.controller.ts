import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import { PolygonTestResponse } from './dto/polygon-status.response';
import { PolygonCatalogService } from './polygon-catalog.service';

@ApiTags('Admin: site & settings')
@RequirePermission('judge.change_settings')
@Controller('api/internal/polygon')
export class PolygonConnectionController {
  constructor(private readonly catalog: PolygonCatalogService) {}

  /**
   * Test the Polygon connection
   *
   * @remarks
   * Needs `judge.change_settings`. Calls Polygon's `problems.list` with the saved
   * key and secret and answers how many problems the account can read. Errors:
   * 409 `polygon_not_connected` (key or secret unset), 502
   * `polygon_unauthorized` (wrong key or secret), 502 `polygon_clock_skew` (the
   * server clock is off by more than Polygon allows), 503 `polygon_unavailable`.
   */
  @Post('test')
  @HttpCode(200)
  test(): Promise<PolygonTestResponse> {
    return this.catalog.testConnection();
  }
}
