import { Injectable } from '@nestjs/common';
import { randomToken, sha256 } from '@libs/auth';
import { AppError, conflictIssue, isDuplicateKey } from '@libs/common';
import { JUDGE_NAME_PATTERN } from '@libs/database';
import { BridgeCommandsService } from '@libs/judging';
import type { CreateJudgeDto, UpdateJudgeDto } from './dto/judge.dto';
import { JudgeResponse } from './dto/judge.response';
import type {
  CreatedJudgeResponse,
  JudgeKeyResponse,
} from './dto/judge.response';
import { JudgesRepository } from './judges.repository';
import type { JudgeChanges } from './judges.repository';

const notFound = () =>
  new AppError('not_found', 404, 'No such judge', undefined, undefined, {
    issues: [
      { field: 'name', code: 'judge_not_found', message: 'No such judge' },
    ],
  });

/** Legacy `Judge` admin: keys are random, shown once and stored hashed; state changes reach a connected judge through bridge commands. */
@Injectable()
export class JudgesService {
  constructor(
    private readonly judges: JudgesRepository,
    private readonly commands: BridgeCommandsService,
  ) {}

  async list(): Promise<JudgeResponse[]> {
    return (await this.judges.list()).map((judge) => JudgeResponse.from(judge));
  }

  async create(dto: CreateJudgeDto): Promise<CreatedJudgeResponse> {
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
    return { judge: await this.one(dto.name), authKey };
  }

  /** The connected judge is dropped: it reconnects only with the new key. */
  async rotateKey(name: string): Promise<JudgeKeyResponse> {
    const authKey = randomToken();
    await this.change(name, { authKeyHash: sha256(authKey) });
    await this.commands.publish({
      type: 'disconnect-judge',
      judgeName: name,
      force: true,
    });
    return { authKey };
  }

  async update(name: string, dto: UpdateJudgeDto): Promise<JudgeResponse> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as JudgeChanges;
    await this.change(name, changes);
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
  async remove(name: string): Promise<void> {
    if (
      JUDGE_NAME_PATTERN.test(name) &&
      (await this.judges.deleteOffline(name))
    )
      return;
    await this.one(name);
    throw conflictIssue(
      'name',
      'judge_online',
      'Disconnect the judge before deleting it.',
    );
  }

  async disconnect(name: string, isForced: boolean): Promise<void> {
    await this.one(name);
    await this.commands.publish({
      type: 'disconnect-judge',
      judgeName: name,
      force: isForced,
    });
  }

  private async one(name: string): Promise<JudgeResponse> {
    const [judge] = JUDGE_NAME_PATTERN.test(name)
      ? await this.judges.list(name)
      : [];
    if (!judge) throw notFound();
    return JudgeResponse.from(judge);
  }

  private async change(name: string, changes: JudgeChanges): Promise<void> {
    if (
      !JUDGE_NAME_PATTERN.test(name) ||
      !(await this.judges.update(name, changes))
    )
      throw notFound();
  }
}
