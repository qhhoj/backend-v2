import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { TagGroupsQuerier } from './tag-groups.querier';
import { TagProblemsRepository } from './tag-problems.repository';
import { TagsController } from './tags.controller';
import { TagsQuerier } from './tags.querier';
import { TagsService } from './tags.service';

@Module({
  imports: [AuthModule],
  controllers: [TagsController],
  providers: [
    TagGroupsQuerier,
    TagsQuerier,
    TagProblemsRepository,
    TagsService,
  ],
  exports: [TagGroupsQuerier, TagsQuerier, TagProblemsRepository],
})
export class TagsApiModule {}
