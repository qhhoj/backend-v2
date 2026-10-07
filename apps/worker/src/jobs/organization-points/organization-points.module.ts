import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import { OrganizationPointsProcessor } from './organization-points.processor';
import { OrganizationPointsRepository } from './organization-points.repository';
import { OrganizationPointsService } from './organization-points.service';

@Module({
  imports: [BullModule.registerQueue({ name: ORGANIZATION_POINTS_QUEUE })],
  providers: [
    OrganizationPointsProcessor,
    OrganizationPointsService,
    OrganizationPointsRepository,
  ],
})
export class OrganizationPointsModule {}
