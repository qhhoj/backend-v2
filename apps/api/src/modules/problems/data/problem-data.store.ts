import { Injectable, Logger } from '@nestjs/common';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, invalidField, isDocumentTooLarge } from '@libs/common';
import { emptyProblemData } from '@libs/database';
import type { Problem, ProblemData } from '@libs/database';
import {
  compileInitYaml,
  dataChanges,
  INIT_FILE,
  listZipEntries,
  ProblemDataError,
  ProblemDataFilesService,
  ZipError,
} from '@libs/problems';
import { ProblemDataResponse } from './dto/problem-data.response';
import { maxTestcasesFor } from '../core/dto/limits';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import { ProblemsRepository } from '../core/problems.repository';
import type { ProblemDocument } from '../core/problems.repository';
import { RevisionsRepository } from '../core/revisions.repository';

/** Access checks, compile-and-persist and the response shape shared by the data and upload services. */
@Injectable()
export class ProblemDataStore {
  private readonly logger = new Logger(ProblemDataStore.name);

  constructor(
    private readonly policy: ProblemEditPolicyService,
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly dataFiles: ProblemDataFilesService,
  ) {}

  async recordChange(
    auth: AuthContext,
    problem: ProblemDocument,
    change: { before: ProblemData; after: ProblemData; comment: string },
  ): Promise<void> {
    const { before, after, comment } = change;
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
    const problem = await this.policy.editableProblem(principal, code);
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

  /** Runs a data change under the judge's writing marker (see `ProblemDataFilesService.withDataWrite`). */
  withDataWrite<T>(
    problem: ProblemDocument,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.dataFiles.withDataWrite(problem.code, work);
  }

  /** Last step of every data change, after init.yml and every file move or removal: stamps `<code>/.data-version` with the version `compileAndStore` wrote (`expected + 1`), the judges' cache key, then records `dataBytes` from the directory (the storage quota's meter). If a step fails after the Mongo write the stamp stays old, so judges wait and the problem fails closed until the next save. Call it inside `withDataWrite`, so the measured directory is not changing. */
  async finishDataWrite(
    problem: ProblemDocument,
    expected: number,
  ): Promise<void> {
    await this.dataFiles.writeDataVersion(problem.code, expected + 1);
    await this.recordDataBytes(problem);
  }

  /** The files and the stamp are already in place, so a failed meter write is logged and not thrown: throwing would refund credits for work that was done. `dataBytes` stays stale until the next write or the nightly backfill. */
  private async recordDataBytes(problem: ProblemDocument): Promise<void> {
    try {
      await this.repository.setDataBytes(
        problem._id,
        await this.dataFiles.bytesOf(problem.code),
      );
    } catch (error) {
      this.logger.error(
        `dataBytes of ${problem.code} not recorded after the data was stored`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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
   * Compiles, then persists with a compare-and-set on `version` and on the code the files are written under, and only then writes or removes init.yml, so Mongo stays authoritative.
   * A 409 means another writer won, or the problem was renamed in between; either way nothing was written. A staged upload that already moved with a renamed directory is left to the hourly stale-upload sweep.
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
        throw invalidField('cases', 'The test data is too large.');
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

  async response(
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
  async archiveNames(code: string, archive: string): Promise<string[]> {
    try {
      return await listZipEntries(this.dataFiles.pathOf(code, archive));
    } catch (error) {
      if (error instanceof ZipError) return [];
      throw error;
    }
  }
}
