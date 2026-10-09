import { Injectable, Logger } from '@nestjs/common';
import type { Principal, ServiceClientPrincipal } from '@libs/auth';
import { AppError, invalidField } from '@libs/common';
import { MAX_CONTEST_PROBLEMS, uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import type { ContestDocument } from '../../contests/core/contests.repository';
import { ContestEditFieldsService } from '../../contests/editing/contest-edit-fields.service';
import {
  ContestEditingService,
  RESERVED_CONTEST_KEYS,
} from '../../contests/editing/contest-editing.service';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { SyncContestDto } from './dto/sync-contest.dto';
import { SyncContestResponse } from './dto/sync-contest.response';
import type {
  SyncUpsertAction,
  SyncUpsertResponse,
} from './dto/sync-contest.response';
import { SyncActsAsService } from './sync-acts-as.service';
import {
  isFrozenForSync,
  isSameSyncedContest,
  toEditDto,
  uniqueCodes,
} from './sync-contest-fields';
import { SyncContestOwnership } from './sync-contest-ownership.service';
import { SyncRateLimit } from './sync-rate-limit.service';

/** Word for word the editor's refusal of a problem the acting user cannot see. */
const UNKNOWN_PROBLEM = 'Unknown problem.';

interface SyncWrite {
  key: string;
  existing: ContestDocument | null;
  fields: Partial<Contest>;
  action: SyncUpsertAction;
}

/** Create, update and read the contests an integration client owns. */
@Injectable()
export class SyncContestsService {
  private readonly logger = new Logger(SyncContestsService.name);

  constructor(
    private readonly ownership: SyncContestOwnership,
    private readonly editing: ContestEditingService,
    private readonly editFields: ContestEditFieldsService,
    private readonly actsAs: SyncActsAsService,
    private readonly problems: ProblemsRepository,
    private readonly rateLimit: SyncRateLimit,
  ) {}

  /** Idempotent create-or-update. `dryRun` validates everything and writes nothing. */
  async put(
    client: ServiceClientPrincipal,
    request: { key: string; body: SyncContestDto; dryRun: boolean },
  ): Promise<SyncUpsertResponse> {
    const { key, body, dryRun } = request;
    await this.rateLimit.charge(client);
    if (RESERVED_CONTEST_KEYS.includes(key))
      throw invalidField('key', 'This key is reserved.', 'key_reserved');
    const existing = await this.ownership.find(client, key);
    const acting = await this.actsAs.principalOf(client);
    const dto = toEditDto(body, await this.problemIds(uniqueCodes(body)));
    const fields = await this.editFields.toFields(acting, dto, existing);
    const action = actionFor(existing, fields, new Date());
    if (!dryRun && action !== 'unchanged')
      await this.write(client, acting, { key, existing, fields, action });
    return {
      key,
      name: fields.name!,
      startTime: fields.startTime!,
      endTime: fields.endTime!,
      isVisible: existing?.isVisible ?? false,
      participantCount: existing?.privateContestants.length ?? 0,
      action,
      dryRun,
    };
  }

  async read(
    client: ServiceClientPrincipal,
    key: string,
  ): Promise<SyncContestResponse> {
    await this.rateLimit.charge(client);
    const contest = await this.ownership.require(client, key);
    await this.actsAs.principalOf(client);
    return SyncContestResponse.from(contest);
  }

  /** New contests are hidden and private, owned by the client and authored by the acting user; `insert` and `applyFields` run the same follow-ups as an editor's save (final-judge schedule, ranking cache, rescore). */
  private async write(
    client: ServiceClientPrincipal,
    acting: Principal,
    job: SyncWrite,
  ): Promise<void> {
    if (job.action === 'created')
      await this.editing.insert(acting, {
        ...job.fields,
        key: job.key,
        isVisible: false,
        isPrivate: true,
        privateContestants: [],
        isOrganizationPrivate: false,
        organizations: [],
        managedBy: client.clientId,
      });
    else
      await this.editing.applyFields(job.existing!, job.fields, {
        isVisible: false,
        startTime: { $gt: new Date() },
      });
    this.logger.log(
      JSON.stringify({
        event: `sync.contest.${job.action}`,
        client: client.clientId,
        key: job.key,
      }),
    );
  }

  /** Problem codes to ids; an unknown code is the same 400 as a problem the acting user cannot see (`toFields`' check), so codes of hidden problems cannot be probed. */
  private async problemIds(codes: string[]): Promise<Map<string, string>> {
    const found = await this.problems.findPage(
      { code: { $in: codes } },
      { code: 1 },
      1,
      MAX_CONTEST_PROBLEMS,
    );
    const ids = new Map(
      found.map((problem) => [problem.code, uuidStr(problem._id)]),
    );
    const unknown = codes.filter((code) => !ids.has(code));
    if (unknown.length) throw invalidField('problems', UNKNOWN_PROBLEM);
    return ids;
  }
}

/** `created` / `unchanged` / `updated`; a change to a contest a person published or that started is refused. */
function actionFor(
  existing: ContestDocument | null,
  fields: Partial<Contest>,
  now: Date,
): SyncUpsertAction {
  if (!existing) return 'created';
  const current = existing.toObject() as Contest;
  if (isSameSyncedContest({ ...current, ...fields }, current))
    return 'unchanged';
  if (isFrozenForSync(existing, now))
    throw new AppError(
      'contest_frozen',
      409,
      'Only the participants of a published or started contest can change',
    );
  return 'updated';
}
