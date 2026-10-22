import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError, invalidField } from '@libs/common';
import type { DataFileKind } from '@libs/database';
import {
  checkerArgsProblem,
  graderArgsProblem,
  ProblemDataFilesService,
} from '@libs/problems';
import { PutProblemDataDto } from './dto/problem-data.dto';
import { ProblemDataResponse } from './dto/problem-data.response';
import { MAX_CASE_ARGS_BYTES, maxTestcasesFor } from '../core/dto/limits';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import { ProblemDataStore } from './problem-data.store';
import { SourceChecksService } from './source-checks.service';

@Injectable()
export class ProblemDataService {
  constructor(
    private readonly policy: ProblemEditPolicyService,
    private readonly store: ProblemDataStore,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly sourceChecks: SourceChecksService,
  ) {}

  async get(auth: AuthContext, code: string): Promise<ProblemDataResponse> {
    const problem = await this.store.managedProblem(auth.principal, code);
    const { data } = await this.store.loadData(problem);
    return this.store.response(
      auth.principal,
      problem,
      data,
      data.archive
        ? await this.store.archiveNames(problem.code, data.archive)
        : [],
    );
  }

  async put(
    auth: AuthContext,
    code: string,
    dto: PutProblemDataDto,
  ): Promise<ProblemDataResponse> {
    const problem = await this.store.writableProblem(auth.principal, code);
    const limit = maxTestcasesFor(auth.principal);
    if (dto.cases.length > limit)
      throw invalidField(
        'cases',
        `Too many testcases, number of testcases must not exceed ${limit}`,
      );
    this.assertArgsSize(dto);
    this.assertArgsFit(dto);
    const { data: previous, version } = await this.store.loadData(problem);
    const data = {
      ...previous,
      ...dto,
      cases: dto.cases.map((row) => ({ ...row })),
    };
    this.store.assertJudgeAccepts(data);
    const { stored, archiveFiles } = await this.store.withDataWrite(
      problem,
      async () => {
        const written = await this.store.compileAndStore(
          problem,
          data,
          version,
        );
        await this.store.finishDataWrite(problem, version);
        return written;
      },
    );
    await this.store.recordChange(auth, problem, {
      before: previous,
      after: stored,
      comment: 'Data edited from site',
    });
    if (stored.grader !== previous.grader)
      await this.sourceChecks.afterFileChange(
        problem._id,
        'customGrader',
        stored,
      );
    return this.store.response(auth.principal, problem, stored, archiveFiles);
  }

  async init(auth: AuthContext, code: string): Promise<string> {
    const problem = await this.store.managedProblem(auth.principal, code);
    const yaml = await this.dataFiles.readInit(problem.code);
    if (yaml === null)
      throw new AppError('not_found', 404, 'No init.yml has been generated');
    return yaml;
  }

  /** Clears the field and recompiles first (Mongo stays authoritative), then drops the file unless another field still names it. */
  async deleteFile(
    auth: AuthContext,
    code: string,
    kind: DataFileKind,
  ): Promise<ProblemDataResponse> {
    const problem = await this.store.writableProblem(auth.principal, code);
    const { data: previous, version } = await this.store.loadData(problem);
    const { stored, archiveFiles } = await this.store.withDataWrite(
      problem,
      async () => {
        const written = await this.store.compileAndStore(
          problem,
          { ...previous, [kind]: null },
          version,
        );
        await this.store.removeUnreferenced(
          problem,
          previous[kind],
          written.stored,
        );
        await this.store.finishDataWrite(problem, version);
        return written;
      },
    );
    await this.store.recordChange(auth, problem, {
      before: previous,
      after: stored,
      comment: `${kind} removed`,
    });
    await this.sourceChecks.afterFileChange(problem._id, kind, stored);
    return this.store.response(auth.principal, problem, stored, archiveFiles);
  }

  /** Legacy `problem_data_file`: editors only (manually managed problems included), an unsafe or unknown name is a 404. */
  async download(
    auth: AuthContext,
    code: string,
    name: string,
  ): Promise<{ path: string; filename: string }> {
    const problem = await this.policy.editableProblem(auth.principal, code);
    const missing = new AppError('not_found', 404, 'No such file');
    let path: string;
    try {
      path = this.dataFiles.pathOf(problem.code, name);
    } catch {
      throw missing;
    }
    if (!(await this.dataFiles.exists(problem.code, name))) throw missing;
    return { path, filename: name };
  }

  /** Each checker and grader gets only the arguments it reads, of the right kind (`checker-args.ts`). */
  private assertArgsFit(dto: PutProblemDataDto): void {
    const checker = checkerArgsProblem(dto.checker, dto.checkerArgs);
    if (checker) throw invalidField('checkerArgs', checker);
    const grader = graderArgsProblem(dto.grader, dto.graderArgs);
    if (grader) throw invalidField('graderArgs', grader);
    dto.cases.forEach((row, index) => {
      const problem = row.checker
        ? checkerArgsProblem(row.checker, row.checkerArgs)
        : null;
      if (problem)
        throw invalidField(
          `cases.${index}.checkerArgs`,
          `Case #${index + 1}: ${problem}`,
        );
    });
  }

  /** All per-case arguments together stay bounded, however the cases split them. */
  private assertArgsSize({ cases }: PutProblemDataDto): void {
    const bytes = cases.reduce(
      (total, row) =>
        total +
        row.generatorArgs.length +
        JSON.stringify(row.checkerArgs).length,
      0,
    );
    if (bytes > MAX_CASE_ARGS_BYTES)
      throw invalidField('cases', 'Case arguments are too large.');
  }
}
