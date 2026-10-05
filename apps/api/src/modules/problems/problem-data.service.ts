import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { rm } from 'node:fs/promises';
import type { AuthContext, Principal } from '@libs/auth';
import {
  AppError,
  isDocumentTooLarge,
  RateLimitService,
  writeFileAtomically,
} from '@libs/common';
import { DATA_FILE_KINDS, emptyProblemData } from '@libs/database';
import type { DataFileKind, Problem, ProblemData } from '@libs/database';
import {
  compileInitYaml,
  INIT_FILE,
  extensionOf,
  listZipEntries,
  ProblemDataError,
  PdfCacheService,
  ProblemDataFilesService,
  safeFileName,
  ZipError,
} from '@libs/problems';
import { PutProblemDataDto } from './dto/problem-data.dto';
import type { SourceFileKind } from './dto/problem-data.dto';
import { ProblemDataResponse } from './dto/problem-data.response';
import { MAX_CASE_ARGS_BYTES, maxTestcasesFor } from './dto/limits';
import { fieldDiff } from './field-diff';
import { readMultipartFile, rejectFile, saveMultipartFile } from './multipart';
import { ProblemEditingService } from './problem-editing.service';
import { ProblemEvents } from './problem.events';
import { ProblemsRepository } from './problems.repository';
import type { ProblemDocument } from './problems.repository';
import { UPLOAD_LIMIT, UPLOAD_WINDOW_SECONDS } from './rate-limits';
import { RevisionsRepository } from './revisions.repository';

export const ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
export const SOURCE_MAX_BYTES = 1024 * 1024;
/** What the compiler can use per kind (the legacy upload validators, minus `.py` checkers the compiler always rejected). */
export const SOURCE_EXTENSIONS: Record<SourceFileKind, readonly string[]> = {
  generator: ['cpp', 'cc', 'c', 'pas', 'java', 'py'],
  customChecker: ['cpp', 'pas', 'java'],
  customGrader: ['cpp'],
  customHeader: ['h'],
};

const invalid = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });

/** Everything but the case rows and the derived feedback. */
const configOf = (data: ProblemData) =>
  Object.fromEntries(
    Object.entries(data).filter(
      ([field]) => field !== 'cases' && field !== 'feedback',
    ),
  );

/** Revisions keep the configuration plus a case summary (count, changed positions), never the case rows twice. */
function dataChanges(before: ProblemData, after: ProblemData) {
  const oldCases = before.cases;
  const newCases = after.cases;
  const changes: Record<string, { before: unknown; after: unknown }> =
    fieldDiff(configOf(before), configOf(after));
  const changed = Array.from(
    { length: Math.max(oldCases.length, newCases.length) },
    (_item, index) => index,
  ).filter(
    (index) =>
      JSON.stringify(oldCases[index]) !== JSON.stringify(newCases[index]),
  );
  if (changed.length)
    changes.cases = {
      before: { count: oldCases.length },
      after: { count: newCases.length, changed },
    };
  return changes;
}

@Injectable()
export class ProblemDataService implements OnModuleInit {
  private readonly logger = new Logger(ProblemDataService.name);

  constructor(
    private readonly editing: ProblemEditingService,
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly rateLimit: RateLimitService,
    private readonly pdfCache: PdfCacheService,
    private readonly events: ProblemEvents,
  ) {}

  /** Both volumes are keyed by code: the data directory follows the problem; cached PDFs are stale after a rename or any statement change. */
  onModuleInit(): void {
    this.events.on(
      'codeRenamed',
      (oldCode, newCode) => void this.moveData(oldCode, newCode),
    );
    this.events.on(
      'statementChanged',
      (problemId) => void this.dropPdfs(problemId),
    );
  }

  /** The new code's PDFs go too: a reused code must not serve another problem's statement. The orphan check in `edit` is not atomic with this move, so a lost race shows up only as the log line. */
  private async moveData(oldCode: string, newCode: string): Promise<void> {
    try {
      await this.pdfCache.delete(oldCode);
      await this.pdfCache.delete(newCode);
      await this.dataFiles.rename(oldCode, newCode);
    } catch (error) {
      this.logger.error(
        `Moving problem data ${oldCode} -> ${newCode} failed`,
        error,
      );
    }
  }

  private async dropPdfs(problemId: string): Promise<void> {
    try {
      const problem = await this.repository.findById(problemId);
      if (problem) await this.pdfCache.delete(problem.code);
    } catch (error) {
      this.logger.error(`Dropping cached PDFs of ${problemId} failed`, error);
    }
  }

  async get(auth: AuthContext, code: string): Promise<ProblemDataResponse> {
    const problem = await this.managedProblem(auth.principal, code);
    const { data } = await this.loadData(problem);
    return this.response(
      auth.principal,
      problem,
      data,
      data.archive ? await this.archiveNames(problem.code, data.archive) : [],
    );
  }

  async put(
    auth: AuthContext,
    code: string,
    dto: PutProblemDataDto,
  ): Promise<ProblemDataResponse> {
    const problem = await this.writableProblem(auth.principal, code);
    const limit = maxTestcasesFor(auth.principal);
    if (dto.cases.length > limit)
      throw invalid(
        'cases',
        `Too many testcases, number of testcases must not exceed ${limit}`,
      );
    this.assertArgsSize(dto);
    const { data: previous, version } = await this.loadData(problem);
    const { stored, archiveFiles } = await this.compileAndStore(
      problem,
      {
        ...previous,
        ...dto,
        cases: dto.cases.map((row) => ({ ...row })),
      },
      version,
    );
    await this.recordChange(
      auth,
      problem,
      previous,
      stored,
      'Data edited from site',
    );
    return this.response(auth.principal, problem, stored, archiveFiles);
  }

  async init(auth: AuthContext, code: string): Promise<string> {
    const problem = await this.managedProblem(auth.principal, code);
    const yaml = await this.dataFiles.readInit(problem.code);
    if (yaml === null)
      throw new AppError('not_found', 404, 'No init.yml has been generated');
    return yaml;
  }

  /**
   * Streams the zip to a staged file, validates it (bounds, names), compiles against the staged path, and only after a matched update gives it its final name and drops the previous archive.
   * Any failure removes the staged file and nothing else, so a lost race never touches the winner's archive.
   */
  async uploadArchive(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    const problem = await this.writableProblem(auth.principal, code);
    await this.reserveUpload(auth);
    const staged = await this.dataFiles.stageUpload(problem.code);
    try {
      const { filename } = await saveMultipartFile(
        request,
        ARCHIVE_MAX_BYTES,
        staged,
        (clientName) => {
          if (extensionOf(safeFileName(clientName)) !== 'zip')
            throw rejectFile('The archive must be a .zip file.');
        },
      );
      const name = safeFileName(filename);
      await this.assertZip(staged);
      const { data: previous, version } = await this.loadData(problem);
      this.assertNameFree(previous, 'archive', name);
      const { stored, archiveFiles } = await this.compileAndStore(
        problem,
        { ...previous, archive: name },
        version,
        staged,
      );
      await this.dataFiles.commitUpload(problem.code, staged, name);
      await this.removeReplaced(problem.code, previous.archive, name);
      await this.recordChange(
        auth,
        problem,
        previous,
        stored,
        'archive uploaded',
      );
      return this.response(auth.principal, problem, stored, archiveFiles);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
  }

  async uploadSource(
    auth: AuthContext,
    code: string,
    kind: SourceFileKind,
    request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    const problem = await this.writableProblem(auth.principal, code);
    await this.reserveUpload(auth);
    const { filename, content } = await readMultipartFile(
      request,
      SOURCE_MAX_BYTES,
    );
    const name = safeFileName(filename);
    if (!SOURCE_EXTENSIONS[kind].includes(extensionOf(name)))
      throw rejectFile(
        `Allowed extensions for ${kind}: ${SOURCE_EXTENSIONS[kind].join(', ')}`,
      );
    const staged = await this.dataFiles.stageUpload(problem.code);
    try {
      await writeFileAtomically(staged, content);
      const { data: previous, version } = await this.loadData(problem);
      this.assertNameFree(previous, kind, name);
      const { stored, archiveFiles } = await this.compileAndStore(
        problem,
        { ...previous, [kind]: name },
        version,
      );
      await this.dataFiles.commitUpload(problem.code, staged, name);
      await this.removeReplaced(problem.code, previous[kind], name);
      await this.recordChange(
        auth,
        problem,
        previous,
        stored,
        `${kind} uploaded`,
      );
      return this.response(auth.principal, problem, stored, archiveFiles);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
  }

  /** Clears the field and recompiles first (Mongo stays authoritative), then drops the file. */
  async deleteFile(
    auth: AuthContext,
    code: string,
    kind: DataFileKind,
  ): Promise<ProblemDataResponse> {
    const problem = await this.writableProblem(auth.principal, code);
    const { data: previous, version } = await this.loadData(problem);
    const { stored, archiveFiles } = await this.compileAndStore(
      problem,
      { ...previous, [kind]: null },
      version,
    );
    const name = previous[kind];
    if (name) await this.dataFiles.removeFile(problem.code, name);
    await this.recordChange(auth, problem, previous, stored, `${kind} removed`);
    return this.response(auth.principal, problem, stored, archiveFiles);
  }

  /** Legacy `problem_data_file`: editors only (manually managed problems included), an unsafe or unknown name is a 404. */
  async download(
    auth: AuthContext,
    code: string,
    name: string,
  ): Promise<{ path: string; filename: string }> {
    const problem = await this.editing.editableProblem(auth.principal, code);
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

  private reserveUpload(auth: AuthContext): Promise<() => Promise<void>> {
    return this.rateLimit.reserve(
      [`upload:user:${auth.principal.userId}`],
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_SECONDS,
    );
  }

  /** A name already used by another kind is refused, so one upload never overwrites a sibling's file. */
  private assertNameFree(
    previous: ProblemData,
    kind: DataFileKind,
    name: string,
  ): void {
    if (
      DATA_FILE_KINDS.some(
        (other) => other !== kind && previous[other] === name,
      )
    )
      throw rejectFile(
        `The name ${name} is already used by another data file.`,
      );
  }

  private async assertZip(path: string): Promise<void> {
    try {
      await listZipEntries(path);
    } catch (error) {
      throw error instanceof ZipError ? rejectFile(error.message) : error;
    }
  }

  private async removeReplaced(
    code: string,
    previousName: string | null,
    name: string,
  ): Promise<void> {
    if (previousName && previousName !== name)
      await this.dataFiles.removeFile(code, previousName);
  }

  private async recordChange(
    auth: AuthContext,
    problem: ProblemDocument,
    before: ProblemData,
    after: ProblemData,
    comment: string,
  ): Promise<void> {
    const changes = dataChanges(before, after);
    if (Object.keys(changes).length)
      await this.revisions.append({
        entity: 'problem',
        entityId: problem._id,
        action: 'data',
        userId: auth.principal.userId,
        changes,
        comment,
      });
  }

  /** Data routes need an editable problem (404/403) that is not manually managed (404, legacy `ProblemManagerMixin`). */
  async managedProblem(
    principal: Principal,
    code: string,
  ): Promise<ProblemDocument> {
    const problem = await this.editing.editableProblem(principal, code);
    if (problem.isManuallyManaged)
      throw new AppError('not_found', 404, 'No such problem');
    return problem;
  }

  /** Writes also need a non-mirror: a mirror's cases come from its source problem (sub-project 6). */
  async writableProblem(
    principal: Principal,
    code: string,
  ): Promise<ProblemDocument> {
    const problem = await this.managedProblem(principal, code);
    if (problem.mirrorOf !== null)
      throw new AppError(
        'forbidden',
        403,
        'Mirror problems take their test data from the source problem',
      );
    return problem;
  }

  /** The stored data as a plain object, with the version to compare-and-set against. `data` is `select: false`, so it is loaded explicitly; the problem from the access check never carries it. */
  async loadData(
    problem: ProblemDocument,
  ): Promise<{ data: ProblemData; version: number }> {
    const loaded = await this.repository.findByCodeWithData(problem.code);
    if (!loaded) throw new AppError('not_found', 404, 'No such problem');
    return {
      data: (loaded.toObject() as Problem).data ?? emptyProblemData(),
      version: loaded.dataVersion,
    };
  }

  /**
   * Compiles, persists with a compare-and-set on `version` and the code the files are written under, so a rename in between is a 409 before anything is written (a staged upload that already moved with the directory is left to the hourly stale-upload sweep) (409 when another writer won) and only then writes or removes init.yml, so Mongo stays authoritative.
   * A configuration or archive problem becomes `feedback`, never an error.
   * Residual window: two sequential winners can still write init.yml out of order (A persists, B persists, B writes, A writes).
   */
  async compileAndStore(
    problem: ProblemDocument,
    data: ProblemData,
    version: number,
    archivePath?: string,
  ): Promise<{ stored: ProblemData; archiveFiles: string[] }> {
    const { stored, yaml, archiveFiles } = await this.compile(
      problem,
      data,
      archivePath,
    );
    let matched: boolean;
    try {
      matched = await this.repository.updateData(
        problem._id,
        problem.code,
        version,
        stored,
      );
    } catch (error) {
      if (isDocumentTooLarge(error))
        throw invalid('cases', 'The test data is too large.');
      throw error;
    }
    if (!matched)
      throw new AppError(
        'conflict',
        409,
        'Test data changed meanwhile, reload',
      );
    if (yaml === null) await this.dataFiles.removeInit(problem.code);
    else await this.dataFiles.writeInit(problem.code, yaml);
    return { stored, archiveFiles };
  }

  /** `archivePath` overrides where the archive is read: a staged upload is compiled before it takes its final name. */
  private async compile(
    problem: ProblemDocument,
    data: ProblemData,
    archivePath?: string,
  ) {
    let archiveFiles: string[] = [];
    try {
      if (data.archive)
        archiveFiles = await listZipEntries(
          archivePath ?? this.dataFiles.pathOf(problem.code, data.archive),
        );
      const compiled = compileInitYaml(data, new Set(archiveFiles));
      return {
        stored: { ...data, cases: compiled.cases, feedback: '' },
        yaml: compiled.yaml,
        archiveFiles,
      };
    } catch (error) {
      if (!(error instanceof ProblemDataError || error instanceof ZipError))
        throw error;
      return {
        stored: { ...data, feedback: error.message },
        yaml: null,
        archiveFiles,
      };
    }
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
      throw invalid('cases', 'Case arguments are too large.');
  }

  private async response(
    principal: Principal,
    problem: ProblemDocument,
    data: ProblemData,
    archiveFiles: string[],
  ): Promise<ProblemDataResponse> {
    return ProblemDataResponse.from(data, {
      archiveFiles,
      hasInit: await this.dataFiles.exists(problem.code, INIT_FILE),
      maxCases: maxTestcasesFor(principal),
    });
  }

  /** A missing or corrupt archive lists as empty; the compile step reports it as feedback. */
  private async archiveNames(code: string, archive: string): Promise<string[]> {
    try {
      return await listZipEntries(this.dataFiles.pathOf(code, archive));
    } catch (error) {
      if (error instanceof ZipError) return [];
      throw error;
    }
  }
}
