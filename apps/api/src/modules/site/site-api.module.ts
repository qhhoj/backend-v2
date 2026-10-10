import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { FlatpageHistoryService } from './admin/flatpage-history.service';
import { FlatpagesAdminController } from './admin/flatpages-admin.controller';
import { FlatpagesAdminService } from './admin/flatpages-admin.service';
import { MiscConfigAdminController } from './admin/misc-config-admin.controller';
import { MiscConfigAdminService } from './admin/misc-config-admin.service';
import { MiscConfigRepository } from './admin/misc-config.repository';
import { FlatpagesController } from './public/flatpages.controller';
import { FlatpagesRepository } from './public/flatpages.repository';
import { FlatpagesService } from './public/flatpages.service';
import { MiscConfigQuerier } from './public/misc-config.querier';
import { SiteController } from './public/site.controller';

@Module({
  imports: [AuthModule, ProblemsApiModule],
  controllers: [
    FlatpagesController,
    SiteController,
    FlatpagesAdminController,
    MiscConfigAdminController,
  ],
  providers: [
    FlatpagesRepository,
    FlatpagesService,
    MiscConfigQuerier,
    FlatpagesAdminService,
    FlatpageHistoryService,
    RateLimitService,
    MiscConfigRepository,
    MiscConfigAdminService,
  ],
})
export class SiteApiModule {}
