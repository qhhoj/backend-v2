import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { rm } from 'node:fs/promises';
import type { AuthContext } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  invalidField,
  RateLimitService,
} from '@libs/common';
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
} from '../problem-data-upload.service';
import { ProblemDataStore } from '../problem-data.store';
import { CHUNK_BYTES, chunkLengthOf } from './chunked-upload.limits';
import type { CreateChunkedUploadDto } from './dto/chunked-upload.dto';
import { ChunkedUploadResponse } from './dto/chunked-upload.response';
import { UploadPartsStore } from './upload-parts.store';
import { UploadSessionsStore } from './upload-sessions.store';
import type { UploadSession } from './upload-sessions.store';

/**
 * A test-data archive sent in chunks: create a session, send each chunk, read what the server holds to resume, then
 * complete, which assembles the chunks, checks size and sha256, and hands the file to the archive upload's own tail
 * (`commitStagedArchive`: zip check, storage and credits, the data lock). Every call needs the archive upload's rights;
 * a session belongs to the user and problem it was created for.
 */
@Injectable()
export class ChunkedUploadsService {
  constructor(
    private readonly store: ProblemDataStore,
    private readonly uploads: ProblemDataUploadService,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly sessions: UploadSessionsStore,
    private readonly parts: UploadPartsStore,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Spends one upload of the user's budget and checks storage up front; credits are only charged at complete. Sweeps the parts of sessions that are gone. */
  async create(
    auth: AuthContext,
    code: string,
    body: CreateChunkedUploadDto,
  ): Promise<ChunkedUploadResponse> {
    const problem = await this.store.writableProblem(auth.principal, code);
    const name = archiveNameOf(body.name);
    await this.uploads.reserveUpload(auth);
    await this.uploads.assertArchiveFits(auth, problem, body.size);
    await this.parts.sweep((id) => this.sessions.isOpen(id));
    const session = await this.sessions.create({
      userId: auth.principal.userId,
      problemId: problem._id,
      name,
      size: body.size,
      sha256: body.sha256,
    });
    return this.responseOf(session, []);
  }

  /** Stores chunk `index` (multipart `file`, exactly its length); a resend replaces it. */
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
    await this.rateLimit.reserve(
      [`upload-chunk:user:${auth.principal.userId}`],
      UPLOAD_CHUNK_LIMIT,
      UPLOAD_CHUNK_WINDOW_SECONDS,
    );
    const length = chunkLengthOf(session.size, index);
    await this.sessions.withSessionLock(session.id, async () => {
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

  /** Answers like the single archive upload. A size or sha256 mismatch drops the session (400 `upload_hash_mismatch`, nothing charged); any later refusal keeps the chunks, so complete can be retried. */
  async complete(
    auth: AuthContext,
    target: { code: string; id: string },
  ): Promise<ProblemDataResponse> {
    const { problem, session } = await this.ownSession(auth, target);
    const answer = await this.sessions.withSessionLock(session.id, async () => {
      await this.assertAllReceived(session);
      const staged = await this.assembleVerified(problem, session);
      return this.uploads.commitStagedArchive(auth, problem, {
        staged,
        name: session.name,
      });
    });
    await this.drop(session);
    return answer;
  }

  async cancel(
    auth: AuthContext,
    target: { code: string; id: string },
  ): Promise<void> {
    const { session } = await this.ownSession(auth, target);
    await this.drop(session);
  }

  /** The chunks in one `stageUpload` file, refused (and the session dropped) unless they are the announced file. */
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
      throw error;
    }
    await rm(staged, { force: true });
    await this.drop(session);
    throw rejectFile(
      'The uploaded chunks do not match the size and SHA-256 given at create; upload the file again.',
      'upload_hash_mismatch',
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
      throw new AppError('not_found', 404, 'No such upload');
    return { problem, session };
  }

  /** Redis first: once the session is gone, the sweep removes parts a failed `rm` left. */
  private async drop(session: UploadSession): Promise<void> {
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
