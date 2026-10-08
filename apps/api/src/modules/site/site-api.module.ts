import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { FlatpagesAdminController } from './admin/flatpages-admin.controller';
import { FlatpagesAdminService } from './admin/flatpages-admin.service';
import { MiscConfigAdminController } from './admin/misc-config-admin.controller';
import { MiscConfigAdminService } from './admin/misc-config-admin.service';
import { MiscConfigRepository } from './admin/misc-config.repository';
import { NavigationAdminController } from './admin/navigation-admin.controller';
import { NavigationAdminService } from './admin/navigation-admin.service';
import { NavigationRepository } from './admin/navigation.repository';
import { FlatpagesController } from './public/flatpages.controller';
import { FlatpagesRepository } from './public/flatpages.repository';
import { FlatpagesService } from './public/flatpages.service';
import { MiscConfigQuerier } from './public/misc-config.querier';
import { NavigationQuerier } from './public/navigation.querier';
import { SiteController } from './public/site.controller';

@Module({
  imports: [AuthModule, ProblemsApiModule],
  controllers: [
    FlatpagesController,
    SiteController,
    FlatpagesAdminController,
    NavigationAdminController,
    MiscConfigAdminController,
  ],
  providers: [
    FlatpagesRepository,
    FlatpagesService,
    NavigationQuerier,
    MiscConfigQuerier,
    FlatpagesAdminService,
    NavigationRepository,
    NavigationAdminService,
    MiscConfigRepository,
    MiscConfigAdminService,
  ],
})
export class SiteApiModule {}
