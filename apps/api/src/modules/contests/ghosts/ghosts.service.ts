import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import {
  CONTEST_REPLAY_QUEUE,
  contestPhase,
  ghostGap,
  notifyReplayBuild,
  replayDelayMs,
} from '@libs/contests';
import type { ContestReplayJob, GhostInput } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestViewerService } from '../core/contest-viewer.service';
import type { ContestDocument } from '../core/contests.repository';
import type {
  GhostImportResponse,
  GhostListResponse,
  GhostResponse,
  ImportGhostsDto,
} from './dto/ghosts.dto';
import { anonymizeLabels, ghostsToCsv, parseGhostCsv } from './ghost-csv';
import type { GhostCsvResult } from './ghost-csv';
import { GhostsRepository } from './ghosts.repository';

interface ProblemColumn {
  problemId: string;
  code: string;
}

/** `fields.csv` keeps the English lines; `issues` carry the code and row the SPA words its own text from. */
const importRefusal = ({ errors, issues }: GhostCsvResult): AppError =>
  new AppError(
    'ghost_import_invalid',
    400,
    'The ghost CSV has errors',
    { csv: errors },
    undefined,
    { issues: issues.map((found) => ({ field: 'csv', ...found })) },
  );

@Injectable()
export class GhostsService {
  private readonly logger = new Logger(GhostsService.name);

  constructor(
    private readonly viewers: ContestViewerService,
    private readonly ghosts: GhostsRepository,
    private readonly problems: ProblemsRepository,
    @InjectQueue(CONTEST_REPLAY_QUEUE)
    private readonly replayQueue: Queue<ContestReplayJob>,
  ) {}

  async importCsv(
    principal: Principal,
    key: string,
    dto: ImportGhostsDto,
  ): Promise<GhostImportResponse> {
    const contest = await this.editable(principal, key);
    this.assertImportable(contest);
    const columns = await this.columnsOf(contest);
    const parsed = parseGhostCsv(
      dto.csv,
      new Map(columns.map((column) => [column.code, column.problemId])),
    );
    if (parsed.issues.length) throw importRefusal(parsed);
    const ghosts = dto.anonymize
      ? anonymizeLabels(parsed.ghosts)
      : parsed.ghosts;
    if (!dto.dryRun) {
      await this.ghosts.replaceAll(contest._id, ghosts);
      await this.rebuildIfOver(contest);
    }
    return {
      stored: !dto.dryRun,
      ghosts: this.responsesOf(contest, columns, ghosts),
    };
  }

  async list(principal: Principal, key: string): Promise<GhostListResponse> {
    const contest = await this.editable(principal, key);
    const columns = await this.columnsOf(contest);
    return {
      ghosts: this.responsesOf(
        contest,
        columns,
        await this.ghosts.findByContest(contest._id),
      ),
    };
  }

  /** The current set in the import grammar, to edit and upload again. */
  async csv(
    principal: Principal,
    key: string,
  ): Promise<{ text: string; filename: string }> {
    const contest = await this.editable(principal, key);
    const columns = await this.columnsOf(contest);
    return {
      text: ghostsToCsv(await this.ghosts.findByContest(contest._id), columns),
      filename: `${contest.key}-ghosts.csv`,
    };
  }

  async remove(principal: Principal, key: string): Promise<void> {
    const contest = await this.editable(principal, key);
    await this.ghosts.removeAll(contest._id);
    await this.rebuildIfOver(contest);
  }

  /** The stored replay embeds the ghosts' events. Once the contest is over a changed set queues a rebuild (waiting for the settle time if needed); before the end no replay is stored, and the first read builds it. */
  private async rebuildIfOver(
    contest: ContestDocument,
    now = new Date(),
  ): Promise<void> {
    if (contestPhase(contest, now) !== 'ended') return;
    await notifyReplayBuild(this.replayQueue, contest._id, this.logger, {
      delayMs: replayDelayMs(contest.endTime, now),
    });
  }

  /** Editors only (403), and a contest the user cannot see is a 404. */
  private editable(
    principal: Principal,
    key: string,
  ): Promise<ContestDocument> {
    return this.viewers.editableContest(principal, key);
  }

  /** Only an import is refused for a format whose scores exist only after the final judge; stored ghosts stay listable and deletable. */
  private assertImportable(contest: ContestDocument): void {
    if (contest.formatName === 'final_submission')
      throw new AppError(
        'ghost_unsupported_format',
        409,
        'Ghosts are not supported for final-submission contests',
      );
  }

  /** The contest's problems in order, with their codes (the CSV's columns). A problem with no summary falls back to its id. */
  private async columnsOf(contest: ContestDocument): Promise<ProblemColumn[]> {
    const ordered = [...contest.problems]
      .sort((left, right) => left.order - right.order)
      .map((entry) => uuidStr(entry.problem));
    const codes = new Map(
      (await this.problems.findSummaries(ordered)).map((problem) => [
        uuidStr(problem._id),
        problem.code,
      ]),
    );
    return ordered.map((problemId) => ({
      problemId,
      code: codes.get(problemId) ?? problemId,
    }));
  }

  private responsesOf(
    contest: ContestDocument,
    columns: ProblemColumn[],
    ghosts: readonly GhostInput[],
  ): GhostResponse[] {
    const codes = new Map(
      columns.map((column) => [column.problemId, column.code]),
    );
    const format = { name: contest.formatName, config: contest.formatConfig };
    return ghosts.map((ghost) => {
      const gap = ghostGap(format, ghost.cells);
      return {
        label: ghost.label,
        caption: ghost.caption,
        isUnranked: gap !== null,
        gap,
        cells: ghost.cells.map((cell) => ({
          problemCode: codes.get(cell.problemId) ?? cell.problemId,
          minute: cell.minute,
          rejectedBefore: cell.rejectedBefore,
          points: cell.points,
        })),
      };
    });
  }
}
