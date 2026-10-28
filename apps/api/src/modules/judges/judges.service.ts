import { Injectable } from '@nestjs/common';
import { randomToken, sha256 } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, conflictIssue, isDuplicateKey } from '@libs/common';
import { JUDGE_NAME_PATTERN } from '@libs/database';
import { BridgeCommandsService } from '@libs/judging';
import type { CreateJudgeDto, UpdateJudgeDto } from './dto/judge.dto';
import { JudgeResponse } from './dto/judge.response';
import type {
  CreatedJudgeResponse,
  JudgeKeyResponse,
} from './dto/judge.response';
import { RevisionsRepository } from '../problems/core/revisions.repository';
import { judgeEditAction, judgeFieldChanges } from './judge-revision';
import type { JudgeAction, JudgeFieldChanges } from './judge-revision';
import { JudgesRepository } from './judges.repository';
import type { JudgeChanges } from './judges.repository';

const notFound = () =>
  new AppError('not_found', 404, 'No such judge', undefined, undefined, {
    issues: [
      { field: 'name', code: 'judge_not_found', message: 'No such judge' },
    ],
  });

/** Legacy `Judge` admin: keys are random, shown once and stored hashed; state changes reach a connected judge through bridge commands. Every write records a `judge` revision with the acting user. */
@Injectable()
export class JudgesService {
  constructor(
    private readonly judges: JudgesRepository,
    private readonly commands: BridgeCommandsService,
    private readonly revisions: RevisionsRepository,
  ) {}

  async list(): Promise<JudgeResponse[]> {
    return (await this.judges.list()).map((judge) => JudgeResponse.from(judge));
  }

  async create(
    principal: Principal,
    dto: CreateJudgeDto,
  ): Promise<CreatedJudgeResponse> {
    const authKey = randomToken();
    try {
      await this.judges.create({
        name: dto.name,
        description: dto.description ?? '',
        authKeyHash: sha256(authKey),
      });
    } catch (error) {
      if (isDuplicateKey(error, 'name'))
        throw conflictIssue('name', 'name_taken', 'This name is taken.');
      throw error;
    }
    const judge = await this.one(dto.name);
    await this.record(principal, judge, 'create', {
      name: { before: null, after: judge.name },
      description: { before: null, after: judge.description },
    });
    return { judge, authKey };
  }

  /** The connected judge is dropped: it reconnects only with the new key. */
  async rotateKey(
    principal: Principal,
    name: string,
  ): Promise<JudgeKeyResponse> {
    const judge = await this.one(name);
    const authKey = randomToken();
    await this.change(name, { authKeyHash: sha256(authKey) });
    await this.record(principal, judge, 'rotate_key');
    await this.commands.publish({
      type: 'disconnect-judge',
      judgeName: name,
      force: true,
    });
    return { authKey };
  }

  async update(
    principal: Principal,
    name: string,
    dto: UpdateJudgeDto,
  ): Promise<JudgeResponse> {
    const before = await this.one(name);
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as JudgeChanges;
    // a reason belongs to a block: unblocking clears it, and an unblocked judge keeps none
    if (!(dto.isBlocked ?? before.isBlocked)) changes.blockReason = '';
    await this.change(name, changes);
    const changed = judgeFieldChanges(before, changes);
    if (Object.keys(changed).length)
      await this.record(principal, before, judgeEditAction(changed), changed);
    if (dto.isBlocked)
      await this.commands.publish({
        type: 'disconnect-judge',
        judgeName: name,
        force: true,
      });
    if (dto.isDisabled !== undefined)
      await this.commands.publish({
        type: 'disable-judge',
        judgeName: name,
        isDisabled: dto.isDisabled,
      });
    return this.one(name);
  }

  /** Legacy: only an offline judge may be deleted. Queued submissions pinned to it fall back to any judge at the bridge's next resync. */
  async remove(principal: Principal, name: string): Promise<void> {
    const judge = await this.one(name);
    if (!(await this.judges.deleteOffline(name)))
      throw conflictIssue(
        'name',
        'judge_online',
        'Disconnect the judge before deleting it.',
      );
    await this.record(principal, judge, 'delete');
  }

  /** Offline only, like delete: the judge's config names it, so it reconnects only once redeployed under the new name. Refused while a run handed to it may still be resumed under the old name. Queued submissions pinned to it follow the rename. */
  async rename(
    principal: Principal,
    name: string,
    newName: string,
  ): Promise<JudgeResponse> {
    const judge = await this.one(name);
    if (newName === name) return judge;
    if (await this.judges.hasRunsInFlight(name))
      throw conflictIssue(
        'name',
        'judge_busy',
        'Submissions handed to this judge are still in flight; wait for them to be requeued.',
      );
    let isRenamed: boolean;
    try {
      isRenamed = await this.judges.renameOffline(name, newName);
    } catch (error) {
      if (isDuplicateKey(error, 'name'))
        throw conflictIssue('name', 'name_taken', 'This name is taken.');
      throw error;
    }
    if (!isRenamed)
      throw conflictIssue(
        'name',
        'judge_online',
        'Disconnect the judge before renaming it.',
      );
    await this.judges.movePins(name, newName);
    await this.record(principal, judge, 'rename', {
      name: { before: name, after: newName },
    });
    // a connection that authenticated under the old name just before the rename is dropped
    await this.commands.publish({
      type: 'disconnect-judge',
      judgeName: name,
      force: true,
    });
    return this.one(newName);
  }

  async disconnect(
    principal: Principal,
    name: string,
    isForced: boolean,
  ): Promise<void> {
    const judge = await this.one(name);
    await this.commands.publish({
      type: 'disconnect-judge',
      judgeName: name,
      force: isForced,
    });
    await this.record(
      principal,
      judge,
      isForced ? 'force_disconnect' : 'disconnect',
    );
  }

  private async one(name: string): Promise<JudgeResponse> {
    const [judge] = JUDGE_NAME_PATTERN.test(name)
      ? await this.judges.list(name)
      : [];
    if (!judge) throw notFound();
    return JudgeResponse.from(judge);
  }

  /** The judge's name is the comment, so the record stays readable after a rename or delete. */
  private record(
    principal: Principal,
    judge: JudgeResponse,
    action: JudgeAction,
    changes: JudgeFieldChanges = {},
  ): Promise<void> {
    return this.revisions.append({
      entity: 'judge',
      entityId: judge.id,
      action,
      userId: principal.userId,
      changes,
      comment: judge.name,
    });
  }

  private async change(name: string, changes: JudgeChanges): Promise<void> {
    if (
      !JUDGE_NAME_PATTERN.test(name) ||
      !(await this.judges.update(name, changes))
    )
      throw notFound();
  }
}
