import { rm } from 'node:fs/promises';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_PUBLISH_QUEUE,
  contestDataPath,
  contestExportPath,
  finalJudgeJobId,
  publishJobId,
  purgeRankingCache,
} from '@libs/contests';
import type { ContestFinalJudgeJob, ContestPublishJob } from '@libs/contests';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import { ContestRemovalRepository } from './contest-removal.repository';

const notDeletable = (message: string) =>
  new AppError('contest_not_deletable', 409, message);

/** Legacy admin single delete (bulk delete stays blocked), for a mistaken, test or cloned contest. */
@Injectable()
export class ContestRemovalService {
  private readonly logger = new Logger(ContestRemovalService.name);

  constructor(
    private readonly contestsService: ContestsService,
    private readonly removal: ContestRemovalRepository,
    private readonly revisions: RevisionsRepository,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
    @InjectQueue(CONTEST_PUBLISH_QUEUE)
    private readonly publishes: Queue<ContestPublishJob>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Editors only, with the key typed again (`confirm`); a visible, rated or still-judging contest, and one with live or virtual participations unless the caller has `judge.edit_all_contest`, is refused with 409 `contest_not_deletable`. */
  async remove(
    principal: Principal,
    key: string,
    confirm: string,
  ): Promise<void> {
    const contest = await this.contestsService.editableContest(principal, key);
    if (confirm !== contest.key)
      throw new AppError(
        'confirmation_mismatch',
        400,
        'Type the contest key to confirm',
      );
    await this.assertDeletable(principal, contest);
    if (!(await this.removal.deleteHidden(contest._id)))
      throw notDeletable('The contest was made visible meanwhile and was kept');
    // Recorded before the cascade: a failing cascade leaves orphan rows keyed by this id, which the revision names.
    await this.revisions.append({
      entity: 'contest',
      entityId: contest._id,
      action: 'delete',
      userId: principal.userId,
      changes: {},
      comment: `${contest.key}: ${contest.name}`,
    });
    await this.removal.deleteOwnedRows(contest._id);
    await this.clearLeftovers(contest);
  }

  /** Hidden only (others may depend on a visible one), never rated (later ratings were computed from it), with nothing left to judge, and without participations unless the caller edits every contest (a contest's results are deleted by staff only). */
  private async assertDeletable(
    principal: Principal,
    contest: ContestDocument,
  ): Promise<void> {
    if (contest.isVisible)
      throw notDeletable('Hide the contest before deleting it');
    if (await this.removal.hasRatings(contest._id))
      throw notDeletable('A rated contest cannot be deleted');
    if (await this.removal.hasUnjudgedSubmissions(contest._id))
      throw notDeletable('Wait until its submissions are judged');
    if (
      !hasPermission(principal, 'judge.edit_all_contest') &&
      (await this.removal.hasParticipations(contest._id))
    )
      throw notDeletable(
        'A contest with participations needs judge.edit_all_contest to delete',
      );
  }

  /** The scheduled end jobs, the cached board and the export and data zips (they hold every contestant's source); a failure is logged, the contest is already gone. */
  private async clearLeftovers(contest: ContestDocument): Promise<void> {
    const log = (what: string) => (error: Error) =>
      this.logger.error(`${what} of ${contest.key}: ${error.message}`);
    await this.finalJudges
      .remove(finalJudgeJobId(contest._id, contest.endTime))
      .catch(log('Final-judge job not removed'));
    await this.publishes
      .remove(publishJobId(contest._id, contest.endTime))
      .catch(log('Publish job not removed'));
    await purgeRankingCache(this.redis, contest._id).catch(
      log('Ranking cache not purged'),
    );
    const root = this.env.contestDataRoot;
    if (root)
      for (const path of [
        contestExportPath(root, contest._id),
        contestDataPath(root, contest._id),
      ])
        await rm(path, { force: true }).catch(log('Contest zip not removed'));
  }
}
