import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import { OrganizationMembersRepository } from './core/organization-members.repository';
import { OrganizationPointsService } from './core/organization-points.service';
import { OrganizationsController } from './core/organizations.controller';
import { OrganizationsRepository } from './core/organizations.repository';
import { OrganizationsService } from './core/organizations.service';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: ORGANIZATION_POINTS_QUEUE }),
  ],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
  ],
  exports: [
    OrganizationsRepository,
    OrganizationMembersRepository,
    OrganizationPointsService,
    OrganizationsService,
  ],
})
export class OrganizationsApiModule {}
