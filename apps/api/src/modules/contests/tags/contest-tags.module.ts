import { Module } from '@nestjs/common';
import { ContestTagsController } from './contest-tags.controller';
import { ContestTagsQuerier } from './contest-tags.querier';
import { ContestTagsRepository } from './contest-tags.repository';
import { ContestTagsService } from './contest-tags.service';

/** Needs only the global database, so it never closes a module cycle; `ContestsApiModule` imports it for the editor's tag check. */
@Module({
  controllers: [ContestTagsController],
  providers: [ContestTagsQuerier, ContestTagsRepository, ContestTagsService],
  exports: [ContestTagsQuerier],
})
export class ContestTagsModule {}
