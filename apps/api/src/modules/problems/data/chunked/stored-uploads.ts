import { Injectable } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import type { ProblemData } from '@libs/database';
import { ProblemDataFilesService } from '@libs/problems';
import { ProblemsRepository } from '../../core/problems.repository';
import type { ProblemDocument } from '../../core/problems.repository';
import { ProblemDataStore } from '../problem-data.store';
import { sha256OfFile } from './upload-parts.store';
import type { UploadSession } from './upload-sessions.store';

/** What identifies an upload's file: its problem, stored name, size and sha256. */
export type UploadedFile = Pick<
  UploadSession,
  'problemId' | 'name' | 'size' | 'sha256'
>;

/**
 * The durable "already stored": the problem's archive is this upload's file (name, then size, then sha256, so a
 * different archive is rarely read), and the judges' `.data-version` stamp is the loaded version, so the write that
 * put it there finished. A write that died before its stamp is not stored. It cannot tell which write stamped: a crashed
 * complete followed by another data write reads as stored (the archive is in place).
 */
@Injectable()
export class StoredUploads {
  constructor(
    private readonly store: ProblemDataStore,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly problems: ProblemsRepository,
  ) {}

  async isStored(
    problem: ProblemDocument,
    loaded: { data: ProblemData; version: number },
    upload: UploadedFile,
  ): Promise<boolean> {
    if (loaded.data.archive !== upload.name) return false;
    if ((await this.dataFiles.readDataVersion(problem.code)) !== loaded.version)
      return false;
    const path = this.dataFiles.pathOf(problem.code, upload.name);
    const size = await stat(path).then(
      (stats) => stats.size,
      () => null,
    );
    return size === upload.size && (await sha256OfFile(path)) === upload.sha256;
  }

  /** For an upload whose session is gone: its problem found by id (a renamed one too); a deleted problem holds nothing. */
  async isStoredById(upload: UploadedFile): Promise<boolean> {
    const problem = await this.problems.findById(upload.problemId);
    if (problem === null) return false;
    return this.isStored(problem, await this.store.loadData(problem), upload);
  }
}
