import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { FlatpagesController } from './flatpages.controller';
import { FlatpagesRepository } from './flatpages.repository';
import { FlatpagesService } from './flatpages.service';
import { MiscConfigQuerier } from './misc-config.querier';
import { NavigationQuerier } from './navigation.querier';
import { SiteController } from './site.controller';

@Module({
  imports: [AuthModule],
  controllers: [FlatpagesController, SiteController],
  providers: [
    FlatpagesRepository,
    FlatpagesService,
    NavigationQuerier,
    MiscConfigQuerier,
  ],
})
export class SiteApiModule {}
