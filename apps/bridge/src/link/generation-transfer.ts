import { status } from '@grpc/grpc-js';
import type {
  ServerReadableStream,
  ServerWritableStream,
  sendUnaryData,
} from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { once } from 'node:events';
import type { Connection, mongo } from 'mongoose';
import type {
  Chunk,
  GenerationRequest,
  UploadChunk,
  UploadReceipt,
} from '@libs/judge-proto';
import { generationBucket } from '@libs/judging';
import type { DispatchTarget } from '../dispatch/slots';
import { GenerationsRepository } from '../generations/generations.repository';
import { SOURCE_CHUNK_BYTES } from './link-limits';
import { drained } from './source-fetch';

export type BundleCall = ServerWritableStream<GenerationRequest, Chunk>;
export type UploadCall = ServerReadableStream<UploadChunk, UploadReceipt>;
/** The calling judge's live session, as far as the transfers need it. */
export type GenerationHolder = Pick<DispatchTarget, 'id' | 'generations'>;

const RESULT_FILE_NAME = 'result.zip';

/** True when the calling judge's live session holds the generation and the request names that session. */
export const heldGeneration = (
  holder: GenerationHolder | undefined,
  generationId: string,
  sessionId: string,
): holder is GenerationHolder =>
  !!holder && sessionId === holder.id && holder.generations.has(generationId);

/** A refusal with the gRPC status to answer with. */
class TransferError extends Error {
  constructor(
    readonly code: status,
    message: string,
  ) {
    super(message);
  }
}

const NOT_HELD = () =>
  new TransferError(
    status.PERMISSION_DENIED,
    'not a generation of this session',
  );

/** Splits a buffer into pieces of at most `SOURCE_CHUNK_BYTES`. */
function* pieces(data: Buffer): Generator<Buffer> {
  for (let at = 0; at < data.length; at += SOURCE_CHUNK_BYTES)
    yield data.subarray(at, at + SOURCE_CHUNK_BYTES);
}

/** The result file being written to GridFS: counts bytes against the plan's cap and never holds more than one chunk in memory. */
class ResultUpload {
  bytes = 0;

  constructor(
    readonly generationId: string,
    private readonly file: mongo.GridFSBucketWriteStream,
    private readonly maxBytes: number,
  ) {}

  get fileId(): unknown {
    return this.file.id;
  }

  async write(data: Buffer): Promise<void> {
    this.bytes += data.length;
    if (this.bytes > this.maxBytes)
      throw new TransferError(
        status.RESOURCE_EXHAUSTED,
        `result over ${this.maxBytes} bytes`,
      );
    if (!this.file.write(data)) await once(this.file, 'drain');
  }

  async finish(): Promise<void> {
    const finished = once(this.file, 'finish');
    this.file.end();
    await finished;
  }

  /** Stops writing and deletes the chunks stored so far. */
  async abort(): Promise<void> {
    await this.file.abort().catch(() => undefined);
  }
}

/** FetchGenerationBundle and UploadGeneratedTests: files move between GridFS and the judge only for a generation the calling judge's live session holds, and never through memory beyond one chunk. */
@Injectable()
export class GenerationTransfer {
  private readonly logger = new Logger(GenerationTransfer.name);
  /** Generations with an upload in progress: a second concurrent upload is refused. */
  private readonly uploading = new Set<string>();

  constructor(
    private readonly rows: GenerationsRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async serveBundle(
    call: BundleCall,
    holder: GenerationHolder | undefined,
  ): Promise<void> {
    try {
      const { generationId, sessionId } = call.request;
      if (!heldGeneration(holder, generationId, sessionId)) throw NOT_HELD();
      const row = await this.rows.runningOf(generationId, holder.id);
      if (!row)
        throw new TransferError(status.NOT_FOUND, 'generation not running');
      await this.streamBundle(call, row.bundleFileId);
    } catch (error) {
      call.emit('error', this.refusal(error, 'FetchGenerationBundle'));
    }
  }

  async receiveUpload(
    call: UploadCall,
    holder: GenerationHolder | undefined,
    reply: sendUnaryData<UploadReceipt>,
  ): Promise<void> {
    let upload: ResultUpload | null = null;
    try {
      for await (const chunk of call as AsyncIterable<UploadChunk>) {
        upload ??= await this.begin(chunk, holder);
        await upload.write(chunk.data);
      }
      if (!upload || call.cancelled)
        throw new TransferError(status.CANCELLED, 'upload ended early');
      reply(null, { bytes: await this.complete(upload, holder!) });
    } catch (error) {
      await upload?.abort();
      reply(this.refusal(error, 'UploadGeneratedTests'));
    } finally {
      if (upload) this.uploading.delete(upload.generationId);
    }
  }

  /** The first message names the generation and session: authorises, takes the one-upload lock and opens the GridFS file. */
  private async begin(
    first: UploadChunk,
    holder: GenerationHolder | undefined,
  ): Promise<ResultUpload> {
    const { generationId, sessionId } = first;
    if (!heldGeneration(holder, generationId, sessionId)) throw NOT_HELD();
    if (this.uploading.has(generationId))
      throw new TransferError(
        status.ALREADY_EXISTS,
        'an upload is in progress',
      );
    this.uploading.add(generationId);
    try {
      const row = await this.rows.runningOf(generationId, holder.id);
      if (!row)
        throw new TransferError(status.NOT_FOUND, 'generation not running');
      if (row.resultFileId)
        throw new TransferError(
          status.ALREADY_EXISTS,
          'result already uploaded',
        );
      const file = generationBucket(this.connection).openUploadStream(
        RESULT_FILE_NAME,
        { metadata: { generationId } },
      );
      return new ResultUpload(generationId, file, row.maxUploadBytes);
    } catch (error) {
      this.uploading.delete(generationId);
      throw error;
    }
  }

  /** Ends the file and records it on the row; a row that moved on or already has a result loses the new file. */
  private async complete(
    upload: ResultUpload,
    holder: GenerationHolder,
  ): Promise<number> {
    await upload.finish();
    const isRecorded = await this.rows.setResult(
      upload.generationId,
      holder.id,
      upload.fileId,
    );
    if (!isRecorded) {
      await this.rows.deleteFile(upload.fileId);
      throw new TransferError(
        status.FAILED_PRECONDITION,
        'result not accepted',
      );
    }
    return upload.bytes;
  }

  /** Chunks of at most 1 MiB, waiting for the judge to drain each; a cancelled call stops reading. */
  private async streamBundle(call: BundleCall, fileId: unknown): Promise<void> {
    const file = generationBucket(this.connection).openDownloadStream(
      fileId as never,
    );
    try {
      for await (const data of file as AsyncIterable<Buffer>)
        for (const part of pieces(data)) {
          if (call.cancelled) return;
          if (!call.write({ data: part }) && !(await drained(call))) return;
        }
      call.end();
    } finally {
      file.destroy();
    }
  }

  private refusal(error: unknown, rpc: string) {
    if (error instanceof TransferError)
      return { code: error.code, details: error.message };
    this.logger.error(`${rpc} failed: ${(error as Error).message}`);
    return { code: status.INTERNAL, details: 'transfer failed' };
  }
}
