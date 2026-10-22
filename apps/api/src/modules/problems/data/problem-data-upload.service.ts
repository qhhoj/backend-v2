import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { rm, stat } from 'node:fs/promises';
import type { AuthContext } from '@libs/auth';
import { RateLimitService, writeFileAtomically } from '@libs/common';
import { dataFileNamesOf } from '@libs/database';
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
import { QuotaService } from '../../organizations/quota/quota.service';
import type { ProblemDocument } from '../core/problems.repository';
import { ProblemStorageQuota } from '../quota/problem-storage-quota.service';
import { ProblemDataStore } from './problem-data.store';
import { SourceChecksService } from './source-checks.service';
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
    private readonly quota: QuotaService,
    private readonly storage: ProblemStorageQuota,
    private readonly sourceChecks: SourceChecksService,
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
      await this.assertZip(staged);
      return await this.storeArchive(auth, problem, {
        staged,
        name: safeFileName(filename),
      });
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
  }

  /** Storage check, then the credits are spent around the whole locked write (compile, commit of the staged file, stamp) and given back if any of it throws. */
  private async storeArchive(
    auth: AuthContext,
    problem: ProblemDocument,
    upload: { staged: string; name: string },
  ): Promise<ProblemDataResponse> {
    const { staged, name } = upload;
    const { data: previous, version } = await this.store.loadData(problem);
    this.assertNameFree(previous, 'archive', name);
    const data = { ...previous, archive: name };
    this.store.assertJudgeAccepts(data);
    const bytes = (await stat(staged)).size;
    const organizationId = this.storage.organizationOf(auth.principal, problem);
    // Deliberately outside the lock: the storage cap is a soft meter. Two parallel uploads to different problems of one organization can both pass and overshoot once; `dataBytes` is re-measured from disk on every write, so the next check sees the true total.
    await this.assertStorageFits(organizationId, problem, {
      bytes,
      replaced: previous.archive,
    });
    const { stored, archiveFiles } = await this.quota.charged(
      organizationId,
      {
        kind: 'upload',
        userId: auth.principal.userId,
        ref: problem.code,
        bytes,
      },
      () =>
        this.store.withDataWrite(problem, async () => {
          const written = await this.store.compileAndStore(
            problem,
            data,
            version,
            staged,
          );
          await this.dataFiles.commitUpload(problem.code, staged, name);
          await this.store.removeUnreferenced(
            problem,
            previous.archive,
            written.stored,
          );
          await this.store.finishDataWrite(problem, version);
          return written;
        }),
    );
    await this.store.recordChange(auth, problem, {
      before: previous,
      after: stored,
      comment: 'archive uploaded',
    });
    await this.storage.afterWrite(organizationId);
    return this.store.response(auth.principal, problem, stored, archiveFiles);
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
      return await this.storeSource(auth, problem, {
        kind,
        name,
        staged,
        bytes: content.length,
      });
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
  }

  /** Source files are small: they are metered for storage but cost no credits. */
  private async storeSource(
    auth: AuthContext,
    problem: ProblemDocument,
    upload: {
      kind: SourceFileKind;
      name: string;
      staged: string;
      bytes: number;
    },
  ): Promise<ProblemDataResponse> {
    const { kind, name, staged, bytes } = upload;
    const { data: previous, version } = await this.store.loadData(problem);
    this.assertNameFree(previous, kind, name);
    const data = { ...previous, [kind]: name };
    this.store.assertJudgeAccepts(data);
    const organizationId = this.storage.organizationOf(auth.principal, problem);
    await this.assertStorageFits(organizationId, problem, {
      bytes,
      replaced: previous[kind],
    });
    const { stored, archiveFiles } = await this.store.withDataWrite(
      problem,
      async () => {
        const written = await this.store.compileAndStore(
          problem,
          data,
          version,
        );
        await this.dataFiles.commitUpload(problem.code, staged, name);
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
      comment: `${kind} uploaded`,
    });
    await this.sourceChecks.afterFileChange(problem._id, kind, stored);
    await this.storage.afterWrite(organizationId);
    return this.store.response(auth.principal, problem, stored, archiveFiles);
  }

  private async assertStorageFits(
    organizationId: string | null,
    problem: ProblemDocument,
    write: { bytes: number; replaced: string | null },
  ): Promise<void> {
    const replacedBytes = await this.storage.replacedBytes(
      problem.code,
      write.replaced,
    );
    await this.storage.assertFits(organizationId, {
      addedBytes: write.bytes - replacedBytes,
    });
  }

  private reserveUpload(auth: AuthContext): Promise<() => Promise<void>> {
    return this.rateLimit.reserve(
      [`upload:user:${auth.principal.userId}`],
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_SECONDS,
    );
  }

  /** A name already used by another kind or by a Polygon helper header is refused, so one upload never overwrites a sibling's file. */
  private assertNameFree(
    previous: ProblemData,
    kind: DataFileKind,
    name: string,
  ): void {
    if (dataFileNamesOf({ ...previous, [kind]: null }).includes(name))
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
}
