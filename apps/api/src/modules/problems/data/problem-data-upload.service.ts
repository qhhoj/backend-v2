import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { rm } from 'node:fs/promises';
import type { AuthContext } from '@libs/auth';
import { RateLimitService, writeFileAtomically } from '@libs/common';
import { DATA_FILE_KINDS } from '@libs/database';
import type { DataFileKind, ProblemData } from '@libs/database';
import {
  extensionOf,
  listZipEntries,
  ProblemDataFilesService,
  safeFileName,
  SOURCE_MAX_BYTES,
  ZipError,
} from '@libs/problems';
import type { SourceFileKind } from './dto/problem-data.dto';
import { ProblemDataResponse } from './dto/problem-data.response';
import {
  readMultipartFile,
  rejectFile,
  saveMultipartFile,
} from '../core/multipart';
import { ProblemDataStore } from './problem-data.store';
import { UPLOAD_LIMIT, UPLOAD_WINDOW_SECONDS } from '../core/rate-limits';

export const ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
/** What the compiler can use per kind (the legacy upload validators, minus `.py` checkers the compiler always rejected). */
export const SOURCE_EXTENSIONS: Record<SourceFileKind, readonly string[]> = {
  generator: ['cpp', 'cc', 'c', 'pas', 'java', 'py'],
  customChecker: ['cpp', 'pas', 'java'],
  customGrader: ['cpp'],
  customHeader: ['h'],
};

@Injectable()
export class ProblemDataUploadService {
  constructor(
    private readonly store: ProblemDataStore,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Streams the zip to a staged file, validates it (bounds, names), compiles against the staged path, and only after a matched update gives it its final name and drops the previous archive.
   * Any failure removes the staged file and nothing else, so a lost race never touches the winner's archive.
   */
  async uploadArchive(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<ProblemDataResponse> {
    const problem = await this.store.writableProblem(auth.principal, code);
    await this.reserveUpload(auth);
    const staged = await this.dataFiles.stageUpload(problem.code);
    try {
      const { filename } = await saveMultipartFile(
        request,
        ARCHIVE_MAX_BYTES,
        staged,
        (clientName) => {
          if (extensionOf(safeFileName(clientName)) !== 'zip')
            throw rejectFile(
              'The archive must be a .zip file.',
              'zip_required',
            );
        },
      );
      const name = safeFileName(filename);
      await this.assertZip(staged);
      const { data: previous, version } = await this.store.loadData(problem);
      this.assertNameFree(previous, 'archive', name);
      const { stored, archiveFiles } = await this.store.compileAndStore(
        problem,
        { ...previous, archive: name },
        version,
        staged,
      );
      await this.dataFiles.commitUpload(problem.code, staged, name);
      await this.removeReplaced(problem.code, previous.archive, name);
      await this.store.recordChange(auth, problem, {
        before: previous,
        after: stored,
        comment: 'archive uploaded',
      });
      return this.store.response(auth.principal, problem, stored, archiveFiles);
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
    const problem = await this.store.writableProblem(auth.principal, code);
    await this.reserveUpload(auth);
    const { filename, content } = await readMultipartFile(
      request,
      SOURCE_MAX_BYTES,
    );
    const name = safeFileName(filename);
    if (!SOURCE_EXTENSIONS[kind].includes(extensionOf(name)))
      throw rejectFile(
        `Allowed extensions for ${kind}: ${SOURCE_EXTENSIONS[kind].join(', ')}`,
        'extension_not_allowed',
      );
    const staged = await this.dataFiles.stageUpload(problem.code);
    try {
      await writeFileAtomically(staged, content);
      const { data: previous, version } = await this.store.loadData(problem);
      this.assertNameFree(previous, kind, name);
      const { stored, archiveFiles } = await this.store.compileAndStore(
        problem,
        { ...previous, [kind]: name },
        version,
      );
      await this.dataFiles.commitUpload(problem.code, staged, name);
      await this.removeReplaced(problem.code, previous[kind], name);
      await this.store.recordChange(auth, problem, {
        before: previous,
        after: stored,
        comment: `${kind} uploaded`,
      });
      return this.store.response(auth.principal, problem, stored, archiveFiles);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
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
        'data_file_name_taken',
      );
  }

  private async assertZip(path: string): Promise<void> {
    try {
      await listZipEntries(path);
    } catch (error) {
      throw error instanceof ZipError
        ? rejectFile(error.message, error.code)
        : error;
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
}
