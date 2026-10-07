import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { excerpt } from '@libs/community';
import { fieldDiff, ProblemDataFilesService } from '@libs/problems';
import { DiscordWebhooksService } from '../../discord/discord-webhooks.service';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { LanguagesQuerier } from '../catalog/languages.querier';
import { ProblemEditPolicyService } from './problem-edit-policy.service';
import {
  toFields,
  withCodeTaken,
  withoutRenderedHtml,
} from './problem-edit-fields';
import { ProblemEvents } from '../core/problem.events';
import { renderField, styleOf } from './problem-markup';
import { ProblemsRepository } from '../core/problems.repository';
import { ProblemsService } from '../core/problems.service';
import { RevisionsRepository } from '../core/revisions.repository';

/** What a submission or a user's points are worth depends on these (legacy rescored on each). */
const RESCORE_FIELDS = ['points', 'partial', 'isOrganizationPrivate'] as const;
/** Besides the statement text, the rendered PDF shows these. */
const PDF_INPUT_FIELDS = ['name', 'timeLimit', 'memoryLimit', 'languageLimits'];

@Injectable()
export class ProblemEditingService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly problems: ProblemsService,
    private readonly policy: ProblemEditPolicyService,
    private readonly languages: LanguagesQuerier,
    private readonly events: ProblemEvents,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly discord: DiscordWebhooksService,
  ) {}

  async create(
    auth: AuthContext,
    dto: CreateProblemDto,
    mode: 'create' | 'suggest',
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const fields = toFields(dto);
    this.policy.assertCreateGates(principal, dto, fields);
    await this.policy.assertReferences(dto);
    const problem = await withCodeTaken(() =>
      this.repository.create({
        ...fields,
        descriptionHtml: renderField(
          fields.description ?? '',
          styleOf({ isFullMarkup: fields.isFullMarkup ?? false }),
          'description',
        ),
        date: fields.date ?? new Date(),
        allowedLanguages:
          fields.allowedLanguages ??
          this.languages.includedInProblems().map((language) => language._id),
        ...(mode === 'suggest'
          ? { suggester: principal.userId, isPublic: false }
          : {
              curators: unique([...(fields.curators ?? []), principal.userId]),
            }),
      }),
    );
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: mode,
      userId: principal.userId,
      changes: fieldDiff({}, withoutRenderedHtml(problem.toJSON())),
      comment: 'Created on site',
    });
    if (mode === 'suggest' || problem.isOrganizationPrivate)
      await this.announce(problem, mode, principal.username);
    return this.problems.detail(principal, problem.code, 'en');
  }

  /** Legacy `on_new_problem` (organization problems) and `on_new_suggested_problem`. The author is the creator: the suggester in suggest mode, a curator otherwise (legacy: `suggester or authors.first()`). Legacy's trailing `Organizations:` line is omitted on purpose (less exposure). */
  private announce(
    problem: Problem,
    mode: 'create' | 'suggest',
    username: string,
  ): Promise<void> {
    const suggested = mode === 'suggest';
    const url = this.discord.link(`/problem/${problem.code}`);
    return this.discord.notify(
      suggested ? 'on_new_suggested_problem' : 'on_new_problem',
      {
        title: `New ${suggested ? 'suggested' : 'organization'} problem ${url}`,
        description: [
          `Title: ${problem.name}`,
          `Statement: ${excerpt(problem.description ?? '', 100)}...\n`,
          `Time limit: ${problem.timeLimit}`,
          `Memory limit (MB): ${problem.memoryLimit / 1024}`,
          `Points: ${problem.points}`,
        ].join('\n'),
        author: this.discord.author(username),
      },
    );
  }

  async edit(
    auth: AuthContext,
    code: string,
    dto: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const problem = await this.policy.editableProblem(principal, code);
    const before = problem.toJSON() as unknown as Record<string, unknown>;
    const fields = toFields(dto);
    this.policy.assertFieldGates(principal, dto, fields, before);
    await this.policy.assertReferences(dto);
    if (
      fields.code !== undefined &&
      fields.code !== problem.code &&
      (await this.dataFiles.exists(fields.code))
    )
      throw new AppError(
        'validation_failed',
        400,
        'Problem data directory is taken',
        { code: ['A test data directory for this code already exists.'] },
      );
    const markupFlipped =
      fields.isFullMarkup !== undefined &&
      fields.isFullMarkup !== problem.isFullMarkup;
    const descriptionChanged =
      fields.description !== undefined &&
      fields.description !== problem.description;
    if (descriptionChanged || markupFlipped) {
      const style = styleOf({
        isFullMarkup: fields.isFullMarkup ?? problem.isFullMarkup,
      });
      fields.descriptionHtml = renderField(
        fields.description ?? problem.description,
        style,
        'description',
      );
      if (markupFlipped)
        fields.translations = (
          before.translations as Problem['translations']
        ).map((translation) => ({
          ...translation,
          descriptionHtml: renderField(
            translation.description,
            style,
            'translations',
          ),
        }));
    }
    await withCodeTaken(() => this.repository.update(problem._id, fields));
    const updated = await this.repository.findById(problem._id);
    if (!updated) throw new AppError('not_found', 404, 'No such problem');
    const changes = fieldDiff(
      withoutRenderedHtml(before),
      withoutRenderedHtml(updated.toJSON()),
    );
    if (!Object.keys(changes).length)
      return this.problems.detail(principal, updated.code, 'en');
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: 'edit',
      userId: principal.userId,
      changes,
      comment: 'Edited from site',
    });
    if ('code' in changes)
      this.events.emit('codeRenamed', problem.code, updated.code);
    if (RESCORE_FIELDS.some((field) => field in changes))
      this.events.emit('pointsChanged', problem._id);
    if ('isPublic' in changes)
      this.events.emit(
        'publicityChanged',
        problem._id,
        updated.suggester === null ? null : uuidStr(updated.suggester),
      );
    if (
      descriptionChanged ||
      markupFlipped ||
      PDF_INPUT_FIELDS.some((field) => field in changes)
    )
      this.events.emit('statementChanged', problem._id);
    return this.problems.detail(principal, updated.code, 'en');
  }
}
