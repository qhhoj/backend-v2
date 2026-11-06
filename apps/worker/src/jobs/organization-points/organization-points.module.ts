import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { OrganizationPointsProcessor } from './organization-points.processor';
import { OrganizationPointsRepository } from './organization-points.repository';
import { OrganizationPointsService } from './organization-points.service';

@Module({
  imports: [JobsModule.register(communityJobs.organizationPoints)],
  providers: [
    OrganizationPointsProcessor,
    OrganizationPointsService,
    OrganizationPointsRepository,
  ],
  exports: [OrganizationPointsService],
})
export class OrganizationPointsModule {}
