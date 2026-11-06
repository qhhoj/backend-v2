import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { rm, stat } from 'node:fs/promises';
import type { AuthContext } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  invalidField,
  RateLimitService,
} from '@libs/common';
import type { ProblemData } from '@libs/database';
import { ProblemDataFilesService } from '@libs/problems';
import { rejectFile, saveMultipartFile } from '../../core/multipart';
import type { ProblemDocument } from '../../core/problems.repository';
import {
  UPLOAD_CHUNK_LIMIT,
  UPLOAD_CHUNK_WINDOW_SECONDS,
} from '../../core/rate-limits';
import { ProblemDataResponse } from '../dto/problem-data.response';
import {
  archiveNameOf,
  ProblemDataUploadService,
  ZipRefusedError,
} from '../problem-data-upload.service';
import { ProblemDataService } from '../problem-data.service';
import { ProblemDataStore } from '../problem-data.store';
import { CHUNK_BYTES, chunkLengthOf } from './chunked-upload.limits';
import type { CreateChunkedUploadDto } from './dto/chunked-upload.dto';
import { ChunkedUploadResponse } from './dto/chunked-upload.response';
import {
  MissingPartError,
  sha256OfFile,
  UploadPartsStore,
} from './upload-parts.store';
import { HeldCharges } from './held-charges.service';
import { UploadPartsSweeper } from './upload-parts.sweeper';
import { UploadSessionsStore } from './upload-sessions.store';
import type { UploadSession } from './upload-sessions.store';

const noSuchUpload = () => new AppError('not_found', 404, 'No such upload');

/**
 * A test-data archive sent in chunks: create a session, send each chunk, read what the server holds to resume, then
 * complete, which assembles the chunks, checks size and sha256, and hands the file to the archive upload's own tail
 * (`commitStagedArchive`: zip check, storage and credits, the data lock). Every call needs the archive upload's rights;
 * a session belongs to the user and problem it was created for.
 */
@Injectable()
export class ChunkedUploadsService {
  private readonly logger = new Logger(ChunkedUploadsService.name);

  constructor(
    private readonly store: ProblemDataStore,
    private readonly data: ProblemDataService,
    private readonly uploads: ProblemDataUploadService,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly sessions: UploadSessionsStore,
    private readonly parts: UploadPartsStore,
    private readonly sweeper: UploadPartsSweeper,
    private readonly rateLimit: RateLimitService,
    private readonly charges: HeldCharges,
  ) {}

  /** Spends one upload of the user's budget and checks storage and credits up front; credits are only charged at complete. Sweeps the parts of sessions that are gone. */
  async create(
    auth: AuthContext,
    code: string,
    body: CreateChunkedUploadDto,
  ): Promise<ChunkedUploadResponse> {
    const problem = await this.store.writableProblem(auth.principal, code);
    const name = archiveNameOf(body.name);
    await this.uploads.reserveUpload(auth);
    await this.uploads.assertArchiveFits(auth, problem, body.size);
    await this.sweeper.sweep();
    const session = await this.sessions.create({
      userId: auth.principal.userId,
      problemId: problem._id,
      name,
      size: body.size,
      sha256: body.sha256,
    });
    return this.responseOf(session, []);
  }

  /** Stores chunk `index` (multipart `file`, exactly its length); a resend replaces it. The session is read again under its lock, so a chunk never lands after complete or cancel, and a 409 `busy` spends no chunk budget. */
  async putChunk(
    auth: AuthContext,
    target: { code: string; id: string; index: number },
    request: FastifyRequest,
  ): Promise<ChunkedUploadResponse> {
    const { session } = await this.ownSession(auth, target);
    const { index } = target;
    if (index >= session.chunkCount)
      throw invalidField(
        'index',
        `The chunk index must be below ${session.chunkCount}.`,
        'chunk_index_out_of_range',
      );
    const length = chunkLengthOf(session.size, index);
    await this.sessions.withSessionLock(session.id, async () => {
      if ((await this.currentSession(session.id)).completed)
        throw noSuchUpload();
      await this.rateLimit.reserve(
        [`upload-chunk:user:${auth.principal.userId}`],
        UPLOAD_CHUNK_LIMIT,
        UPLOAD_CHUNK_WINDOW_SECONDS,
      );
      await this.parts.write(session.id, index, async (path) => {
        const { bytes } = await saveMultipartFile(request, length, path);
        if (bytes !== length)
          throw rejectFile(
            `Chunk ${index} must be ${length} bytes.`,
            'chunk_size_mismatch',
          );
      });
      await this.sessions.markReceived(session, index);
    });
    return this.responseOf(session, await this.sessions.received(session.id));
  }

  async status(
    auth: AuthContext,
    target: { code: string; id: string },
  ): Promise<ChunkedUploadResponse> {
    const { session } = await this.ownSession(auth, target);
    return this.responseOf(session, await this.sessions.received(session.id));
  }

  /**
   * Answers like the single archive upload. Already stored (see `storedState`) answers the stored data and charges
   * nothing, so a complete retried after a lost answer, a lost marker or a restart never stores twice. Otherwise it gives
   * back a charge a previous complete still holds (the process died inside its write), spends one upload of the budget,
   * joins and checks the chunks, and stores them pinned to the data version it read: a write that lands meanwhile,
   * including a second complete after a lost lock, makes this one 409 `conflict` (refunded if it had spent). A size or
   * sha256 mismatch, or a refused zip, drops the session (nothing charged); any other refusal keeps the chunks, so
   * complete can be retried.
   */
  async complete(
    auth: AuthContext,
    target: { code: string; id: string },
  ): Promise<ProblemDataResponse> {
    const { problem, session } = await this.ownSession(auth, target);
    const answer = await this.sessions.withSessionLock(session.id, async () => {
      const { stored, version } = await this.storedState(problem, session);
      if (stored) {
        await this.sessions.releaseCharge(session.id);
        await this.sessions.markCompleted(session);
        return this.data.get(auth, problem.code);
      }
      await this.assertAllReceived(session);
      await this.charges.giveBack(session.id);
      await this.uploads.reserveUpload(auth);
      const staged = await this.assembleVerified(problem, session);
      await this.assertStillOpen(session, staged);
      const answered = await this.commitVerified(auth, problem, {
        session,
        staged,
        version,
      });
      await this.sessions.markCompleted(session);
      return answered;
    });
    await this.removePartsAfterStore(session.id);
    return answer;
  }

  /** Under the session's lock: a chunk or complete running is 409 `busy`, so a cancel never answers while a complete may still store. A stored upload (the same durable check as complete) can no longer be cancelled (404); dropping it gives back a charge a crashed complete still holds. */
  async cancel(
    auth: AuthContext,
    target: { code: string; id: string },
  ): Promise<void> {
    const { problem, session } = await this.ownSession(auth, target);
    await this.sessions.withSessionLock(session.id, async () => {
      if ((await this.storedState(problem, session)).stored)
        throw noSuchUpload();
      await this.drop(session);
    });
  }

  /** Under the session's lock: whether the upload is stored (marked completed, or durably: `isStored`), and the data version read for it. */
  private async storedState(
    problem: ProblemDocument,
    session: UploadSession,
  ): Promise<{ stored: boolean; version: number }> {
    const { completed } = await this.currentSession(session.id);
    const { data, version } = await this.store.loadData(problem);
    return {
      stored:
        completed || (await this.isStored(problem, { data, version }, session)),
      version,
    };
  }

  /** The durable "already stored": the problem's archive is this session's file (name, then size, then sha256, so a different archive is rarely read), and the judges' `.data-version` stamp is the loaded version, so the write that put it there finished. A write that failed before its stamp is stored again. */
  private async isStored(
    problem: ProblemDocument,
    loaded: { data: ProblemData; version: number },
    session: UploadSession,
  ): Promise<boolean> {
    if (loaded.data.archive !== session.name) return false;
    if ((await this.dataFiles.readDataVersion(problem.code)) !== loaded.version)
      return false;
    const path = this.dataFiles.pathOf(problem.code, session.name);
    const size = await stat(path).then(
      (stats) => stats.size,
      () => null,
    );
    return (
      size === session.size && (await sha256OfFile(path)) === session.sha256
    );
  }

  /** Narrows a lapsed lock: a session cancelled while the chunks were joined is not stored. */
  private async assertStillOpen(
    session: UploadSession,
    staged: string,
  ): Promise<void> {
    try {
      await this.currentSession(session.id);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
  }

  /** Hands the verified file to the archive upload's tail; a refused zip ends the session, since the same bytes can never pass. */
  private async commitVerified(
    auth: AuthContext,
    problem: ProblemDocument,
    upload: { session: UploadSession; staged: string; version: number },
  ): Promise<ProblemDataResponse> {
    const { session, staged, version } = upload;
    try {
      return await this.uploads.commitStagedArchive(auth, problem, {
        staged,
        name: session.name,
        expectedVersion: version,
        journal: this.charges.journalOf(session),
      });
    } catch (error) {
      if (error instanceof ZipRefusedError) await this.drop(session);
      throw error;
    }
  }

  /** The archive is stored and charged: a failed cleanup is only logged, the sweep removes the parts once the session expires. */
  private async removePartsAfterStore(id: string): Promise<void> {
    try {
      await this.parts.remove(id);
    } catch (error) {
      this.logger.warn(
        `Removing the parts of upload ${id} failed: ${(error as Error).message}`,
      );
    }
  }

  /** The chunks in one `stageUpload` file, refused (and the session dropped) unless they are the announced file; a part lost on disk is 409 `chunks_missing` and must be sent again. */
  private async assembleVerified(
    problem: ProblemDocument,
    session: UploadSession,
  ): Promise<string> {
    const staged = await this.dataFiles.stageUpload(problem.code);
    try {
      const { bytes, sha256 } = await this.parts.assemble(
        session.id,
        session.chunkCount,
        staged,
      );
      if (bytes === session.size && sha256 === session.sha256) return staged;
    } catch (error) {
      await rm(staged, { force: true });
      if (error instanceof MissingPartError)
        throw await this.lost(session, error);
      throw error;
    }
    await rm(staged, { force: true });
    await this.drop(session);
    throw rejectFile(
      'The uploaded chunks do not match the size and SHA-256 given at create; upload the file again.',
      'upload_hash_mismatch',
    );
  }

  private async lost(
    session: UploadSession,
    error: MissingPartError,
  ): Promise<AppError> {
    await this.sessions.unmarkReceived(session.id, error.index);
    return conflictIssue(
      'upload',
      'chunks_missing',
      `Chunk ${error.index} is missing; send it again.`,
    );
  }

  private async assertAllReceived(session: UploadSession): Promise<void> {
    const received = await this.sessions.received(session.id);
    if (received.length < session.chunkCount)
      throw conflictIssue(
        'upload',
        'chunks_missing',
        `${session.chunkCount - received.length} chunks are still missing.`,
      );
  }

  /** The session behind `id`, only for its creator on the problem it was created for, who still has the upload rights; anything else is 404. */
  private async ownSession(
    auth: AuthContext,
    target: { code: string; id: string },
  ): Promise<{ problem: ProblemDocument; session: UploadSession }> {
    const problem = await this.store.writableProblem(
      auth.principal,
      target.code,
    );
    const session = await this.sessions.get(target.id);
    if (
      session === null ||
      session.userId !== auth.principal.userId ||
      session.problemId !== problem._id
    )
      throw noSuchUpload();
    return { problem, session };
  }

  /** The session as Redis holds it now (read again under its lock); gone is 404. */
  private async currentSession(id: string): Promise<UploadSession> {
    const session = await this.sessions.get(id);
    if (session === null) throw noSuchUpload();
    return session;
  }

  /** Ends the session: gives back a charge a crashed complete still holds, then Redis, then the parts (once the session is gone, the sweep removes parts a failed `rm` left). */
  private async drop(session: UploadSession): Promise<void> {
    await this.charges.giveBack(session.id);
    await this.sessions.remove(session);
    await this.parts.remove(session.id);
  }

  private responseOf(
    session: UploadSession,
    received: number[],
  ): ChunkedUploadResponse {
    return {
      id: session.id,
      name: session.name,
      size: session.size,
      chunkBytes: CHUNK_BYTES,
      chunkCount: session.chunkCount,
      received,
      expiresAt: new Date(session.expiresAt),
    };
  }
}
