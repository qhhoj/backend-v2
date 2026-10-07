import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ContestViewerService } from './contest-viewer.service';
import { ContestsRepository } from './contests.repository';
import { ParticipationsRepository } from './participations.repository';

/** Contest reads every api module needs (problems for contest-only access, submissions for freeze-safe lists); depends only on the global `DatabaseModule`, so it never closes a module cycle. */
@Module({
  imports: [AuthModule],
  providers: [
    ContestsRepository,
    ParticipationsRepository,
    ContestViewerService,
  ],
  exports: [ContestsRepository, ParticipationsRepository, ContestViewerService],
})
export class ContestAccessModule {}
