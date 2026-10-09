import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { Paginated, RateLimitService, unique } from '@libs/common';
import { balloonItems, isFrozen, problemLabel } from '@libs/contests';
import type { BalloonItem } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestAccess } from '../core/contest-access';
import { ContestViewerService } from '../core/contest-viewer.service';
import type { ContestDocument } from '../core/contests.repository';
import { RankingUsersRepository } from '../ranking/ranking-users.repository';
import { balloonRefusal, withIssueCode } from './balloon-refusal';
import { BalloonsRepository } from './balloons.repository';
import type { DeliveryRecord, LiveBalloonRow } from './balloons.repository';
import type {
  BalloonPageMetaResponse,
  BalloonQueryDto,
  BalloonResponse,
  BalloonState,
} from './dto/balloons.dto';
import {
  BALLOON_WRITE_LIMIT,
  BALLOON_WRITE_WINDOW_SECONDS,
  FROZEN_READ_AUDIT_WINDOW_SECONDS,
} from './rate-limits';

/** One balloon: a team's solved problem. */
export interface BalloonTarget {
  participationId: string;
  problemId: string;
}

interface QueueEntry {
  item: BalloonItem;
  delivery: DeliveryRecord | null;
}

const keyOf = (participationId: string, problemId: string) =>
  `${participationId}:${problemId}`;
const isShown = (entry: QueueEntry, state: BalloonState) =>
  state === 'all' || (state === 'delivered') === (entry.delivery !== null);
const orderedProblemIds = (contest: ContestDocument): string[] =>
  [...contest.problems]
    .sort((left, right) => left.order - right.order)
    .map((entry) => uuidStr(entry.problem));

@Injectable()
export class BalloonsService {
  private readonly logger = new Logger(BalloonsService.name);

  constructor(
    private readonly viewers: ContestViewerService,
    private readonly balloons: BalloonsRepository,
    private readonly problems: ProblemsRepository,
    private readonly rankingUsers: RankingUsersRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Derived on every read from the live cells; a delivery whose cell is no longer solved is not listed. Nothing is written to the database. */
  async list(
    principal: Principal,
    key: string,
    query: BalloonQueryDto,
    now = new Date(),
  ): Promise<Paginated<BalloonResponse, BalloonPageMetaResponse>> {
    const contest = await this.balloonContest(principal, key);
    const isHidingProgress = await this.hidesProgress(principal, contest, now);
    const { entries, rows } = await this.queueOf(contest);
    const shown = entries.filter((entry) => isShown(entry, query.state));
    const start = (query.page - 1) * query.pageSize;
    const page = shown.slice(start, start + query.pageSize);
    const totalOf = (isPending: boolean) =>
      isHidingProgress
        ? null
        : entries.filter((entry) => (entry.delivery === null) === isPending)
            .length;
    return new Paginated(
      await this.responsesOf(contest, page, rows, isHidingProgress),
      {
        page: query.page,
        pageSize: query.pageSize,
        total: shown.length,
        pendingTotal: totalOf(true),
        deliveredTotal: totalOf(false),
      },
    );
  }

  async deliver(
    principal: Principal,
    key: string,
    target: BalloonTarget,
  ): Promise<void> {
    const contest = await this.writableContest(principal, key);
    await this.assertSolved(contest, target);
    const isNew = await this.balloons.markDelivered(contest._id, {
      participation: target.participationId,
      problem: target.problemId,
      deliveredAt: new Date(),
      deliveredBy: principal.userId,
    });
    if (!isNew)
      throw balloonRefusal(
        409,
        'conflict',
        'already_delivered',
        'This balloon was already delivered',
      );
  }

  async undeliver(
    principal: Principal,
    key: string,
    target: BalloonTarget,
  ): Promise<void> {
    const contest = await this.writableContest(principal, key);
    const wasDelivered = await this.balloons.unmarkDelivered(
      contest._id,
      target.participationId,
      target.problemId,
    );
    if (!wasDelivered)
      throw balloonRefusal(
        409,
        'conflict',
        'not_delivered',
        'This balloon was not delivered',
      );
  }

  /** Visible first (404, `canSee`), then balloons on (404), then the right (403): a volunteer listed on a contest they cannot see learns nothing. A volunteer who is also a contestant is refused: live solves of every team, also during a freeze, would let them approximate the standings. Editors are never refused. */
  private async balloonContest(
    principal: Principal,
    key: string,
  ): Promise<ContestDocument> {
    const contest = await this.viewers
      .visibleContest(principal, key)
      .catch((error: unknown) => {
        throw withIssueCode(error);
      });
    if (!contest.balloons)
      throw balloonRefusal(
        404,
        'not_found',
        'balloons_off',
        'Balloons are off for this contest',
      );
    const view = ContestAccess.accessView(contest);
    if (!ContestAccess.canViewBalloons(principal, view))
      throw balloonRefusal(
        403,
        'forbidden',
        'balloons_forbidden',
        'You cannot use the balloon screen of this contest',
      );
    if (
      !ContestAccess.canEdit(principal, view) &&
      (await this.balloons.hasParticipation(contest._id, principal.userId))
    )
      throw balloonRefusal(
        403,
        'forbidden',
        'contestant_forbidden',
        'A contestant cannot use the balloon screen',
      );
    return contest;
  }

  /** True when the reader may not see solve times or totals: the contest is frozen and the reader cannot edit it (the queue order stays, the numbers that rebuild the standings do not). Every read during a freeze is audited, once per user and minute. */
  private async hidesProgress(
    principal: Principal,
    contest: ContestDocument,
    now: Date,
  ): Promise<boolean> {
    if (!isFrozen(contest, now)) return false;
    const hits = await this.rateLimit.hit(
      `balloons-frozen-read:${contest._id}:${principal.userId}`,
      FROZEN_READ_AUDIT_WINDOW_SECONDS,
    );
    if (hits === 1)
      this.logger.log({
        event: 'balloons.read_frozen',
        contestId: contest._id,
        actorId: principal.userId,
      });
    return !ContestAccess.canEdit(principal, ContestAccess.accessView(contest));
  }

  private async writableContest(
    principal: Principal,
    key: string,
  ): Promise<ContestDocument> {
    const contest = await this.balloonContest(principal, key);
    await this.rateLimit
      .reserve(
        [`balloon-write:${principal.userId}`],
        BALLOON_WRITE_LIMIT,
        BALLOON_WRITE_WINDOW_SECONDS,
      )
      .catch((error: unknown) => {
        throw withIssueCode(error);
      });
    return contest;
  }

  private async assertSolved(
    contest: ContestDocument,
    target: BalloonTarget,
  ): Promise<void> {
    const { entries } = await this.queueOf(contest);
    const isSolved = entries.some(
      ({ item }) =>
        item.participationId === target.participationId &&
        item.problemId === target.problemId,
    );
    if (!isSolved)
      throw balloonRefusal(
        404,
        'not_found',
        'balloon_not_found',
        'This team has not solved this problem',
      );
  }

  private async queueOf(
    contest: ContestDocument,
  ): Promise<{ entries: QueueEntry[]; rows: LiveBalloonRow[] }> {
    const [rows, deliveries] = await Promise.all([
      this.balloons.liveRows(contest._id),
      this.balloons.deliveries(contest._id),
    ]);
    const problems = [...contest.problems]
      .sort((left, right) => left.order - right.order)
      .map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      }));
    const items = balloonItems(
      { name: contest.formatName, config: contest.formatConfig },
      problems,
      rows.map((row) => ({
        participationId: row.participationId,
        virtual: 0,
        cells: row.cells,
      })),
    );
    const delivered = new Map(
      deliveries.map((delivery) => [
        keyOf(delivery.participation, delivery.problem),
        delivery,
      ]),
    );
    return {
      entries: items.map((item) => ({
        item,
        delivery:
          delivered.get(keyOf(item.participationId, item.problemId)) ?? null,
      })),
      rows,
    };
  }

  private async codesOf(ordered: string[]): Promise<Map<string, string>> {
    const summaries = await this.problems.findSummaries(ordered);
    return new Map(
      summaries.map((problem) => [uuidStr(problem._id), problem.code]),
    );
  }

  private async responsesOf(
    contest: ContestDocument,
    page: QueueEntry[],
    rows: LiveBalloonRow[],
    isHidingTimes: boolean,
  ): Promise<BalloonResponse[]> {
    const ordered = orderedProblemIds(contest);
    const codes = await this.codesOf(ordered);
    const userOf = new Map(
      rows.map((row) => [row.participationId, row.userId]),
    );
    const people = await this.rankingUsers.rankingUsersOf(
      unique([
        ...page.map(({ item }) => userOf.get(item.participationId)!),
        ...page.flatMap(({ delivery }) =>
          delivery ? [delivery.deliveredBy] : [],
        ),
      ]),
    );
    return page.map(({ item, delivery }) => {
      const userId = userOf.get(item.participationId)!;
      return {
        participationId: item.participationId,
        problemId: item.problemId,
        problemCode: codes.get(item.problemId) ?? '',
        problemLabel: problemLabel(
          ordered.indexOf(item.problemId),
          contest.labelStyle,
        ),
        team: { userId, username: people.get(userId)?.username ?? '' },
        solvedAt: isHidingTimes ? null : item.solvedAt,
        isFirst: item.isFirst,
        deliveredAt: delivery?.deliveredAt.toISOString() ?? null,
        deliveredBy: delivery
          ? (people.get(delivery.deliveredBy)?.username ?? null)
          : null,
      };
    });
  }
}
