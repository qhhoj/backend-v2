import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { ContestAccess } from '../core/contest-access';
import { ContestViewerService } from '../core/contest-viewer.service';
import { ContestsService } from '../core/contests.service';
import type {
  OfficialRankingResponse,
  SetOfficialRankingDto,
} from './dto/official-ranking.dto';
import { CsvRankingError, parseOfficialRanking } from './official-ranking';
import { OfficialRankingsRepository } from './official-rankings.repository';

const csvError = (message: string) =>
  new AppError('validation_failed', 400, message, { csv: [message] });

/** The CMS export an editor uploads, or the URL of an external ranking. */
@Injectable()
export class OfficialRankingService {
  constructor(
    private readonly rankings: OfficialRankingsRepository,
    private readonly contestsService: ContestsService,
    private readonly viewers: ContestViewerService,
  ) {}

  async set(
    principal: Principal,
    key: string,
    dto: SetOfficialRankingDto,
  ): Promise<OfficialRankingResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    if (dto.csv !== undefined && dto.url !== undefined)
      throw csvError('Send either csv or url');
    const fields =
      dto.url !== undefined
        ? { url: dto.url, problems: [], rows: [] }
        : { url: null, ...this.parse(dto.csv!) };
    await this.rankings.replace(contest._id, fields);
    return this.response(fields);
  }

  async remove(principal: Principal, key: string): Promise<void> {
    const contest = await this.contestsService.editableContest(principal, key);
    await this.rankings.remove(contest._id);
  }

  /** Legacy `check_can_see_own_scoreboard`. */
  async show(
    principal: Principal | null,
    key: string,
    now = new Date(),
  ): Promise<OfficialRankingResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const viewer = await this.viewers.viewerOf(principal, contest, now);
    if (
      !ContestAccess.canSeeOwnScoreboard(
        principal,
        ContestAccess.accessView(contest),
        now,
        viewer,
      )
    )
      throw new AppError(
        'forbidden',
        403,
        'The ranking of this contest is hidden',
      );
    const stored = await this.rankings.findByContest(contest._id);
    if (!stored)
      throw new AppError(
        'not_found',
        404,
        'This contest has no official ranking',
      );
    return this.response(stored);
  }

  private parse(csv: string) {
    try {
      return parseOfficialRanking(csv);
    } catch (error) {
      if (error instanceof CsvRankingError) throw csvError(error.message);
      throw error;
    }
  }

  private response(
    stored: Pick<OfficialRankingResponse, 'url' | 'problems'> & {
      rows: Omit<OfficialRankingResponse['rows'][number], 'rank'>[];
    },
  ): OfficialRankingResponse {
    return {
      url: stored.url,
      problems: stored.problems,
      rows: stored.rows.map((row, index) => ({ ...row, rank: index + 1 })),
    };
  }
}
