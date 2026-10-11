import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import {
  CreateJudgeDto,
  DisconnectJudgeDto,
  JudgeNameParamDto,
  UpdateJudgeDto,
} from './dto/judge.dto';
import {
  CreatedJudgeResponse,
  JudgeKeyResponse,
  JudgeResponse,
} from './dto/judge.response';
import { JudgesService } from './judges.service';
import { JudgeQueueResponse } from './queue/dto/judge-queue.response';
import { JudgeQueueService } from './queue/judge-queue.service';

@ApiTags('Admin: judges & languages')
@RequirePermission('judge.change_judge')
@Controller('api/internal/judges')
export class JudgesController {
  constructor(
    private readonly judges: JudgesService,
    private readonly queue: JudgeQueueService,
  ) {}

  /**
   * List judge servers
   *
   * @remarks
   * Needs `judge.change_judge`. Returns every judge sorted by name with its
   * online state, ping, load, slots in use, runtimes and last IP. Authentication
   * keys are never returned.
   */
  @Get()
  list(): Promise<JudgeResponse[]> {
    return this.judges.list();
  }

  /**
   * Get the judging queue's health
   *
   * @remarks
   * Needs `judge.change_judge`. Counts queued (QU), handed-out (P) and grading
   * (G) submissions; when the longest-waiting queued one was submitted or
   * rejudged; queued counts per priority (0 contest, 1 normal, 2 rejudge, 3
   * batch rejudge), per language with how many usable online judges run it (0
   * means that language cannot drain), and per judge they are pinned to.
   */
  @Get('queue')
  queueSummary(): Promise<JudgeQueueResponse> {
    return this.queue.summary();
  }

  /**
   * Register a judge server
   *
   * @remarks
   * Needs `judge.change_judge`. `name` uses letters, digits, `_`, `.` or `-` (at
   * most 50) and is what the judge sends when it connects. Returns the judge and
   * its `authKey`, shown only this once (only a hash is stored). Responds 409
   * `conflict` (issue `name_taken`) when the name exists.
   */
  @Post()
  create(@Body() dto: CreateJudgeDto): Promise<CreatedJudgeResponse> {
    return this.judges.create(dto);
  }

  /**
   * Update a judge server
   *
   * @remarks
   * Needs `judge.change_judge`. Send only the fields to change: `isBlocked`,
   * `isDisabled` and `description`. Blocking disconnects the judge and refuses
   * it until unblocked; disabling tells a connected judge to stop taking work,
   * enabling lets it resume. Responds 404 `not_found` (issue `judge_not_found`)
   * for an unknown name.
   */
  @Patch(':name')
  update(
    @Param() { name }: JudgeNameParamDto,
    @Body(new RefuseNullFieldsPipe()) dto: UpdateJudgeDto,
  ): Promise<JudgeResponse> {
    return this.judges.update(name, dto);
  }

  /**
   * Delete a judge server
   *
   * @remarks
   * Needs `judge.change_judge`. Only an offline judge can be deleted: 409
   * `conflict` (issue `judge_online`) while it is connected, 404 `not_found` for
   * an unknown name. Queued submissions pinned to it fall back to any judge.
   * Answers 204.
   */
  @Delete(':name')
  @HttpCode(204)
  remove(@Param() { name }: JudgeNameParamDto): Promise<void> {
    return this.judges.remove(name);
  }

  /**
   * Issue a new authentication key for a judge
   *
   * @remarks
   * Needs `judge.change_judge`. The old key stops working and a connected judge
   * is disconnected; it can only reconnect with the new `authKey`, returned only
   * this once. Responds 404 `not_found` for an unknown name.
   */
  @Post(':name/key')
  @HttpCode(200)
  rotateKey(@Param() { name }: JudgeNameParamDto): Promise<JudgeKeyResponse> {
    return this.judges.rotateKey(name);
  }

  /**
   * Disconnect a judge server
   *
   * @remarks
   * Needs `judge.change_judge`. Asks the bridge to disconnect the judge; it may
   * reconnect. With `force` every session and socket of the judge is retired at
   * once. Answers 204; 404 `not_found` for an unknown name.
   */
  @Post(':name/disconnect')
  @HttpCode(204)
  disconnect(
    @Param() { name }: JudgeNameParamDto,
    @Body() { force }: DisconnectJudgeDto,
  ): Promise<void> {
    return this.judges.disconnect(name, force);
  }
}
