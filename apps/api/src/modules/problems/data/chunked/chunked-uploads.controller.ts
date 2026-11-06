import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiFileUpload } from '@libs/common';
import { ProblemCodeParamDto } from '../../core/dto/problem-params.dto';
import { ProblemDataResponse } from '../dto/problem-data.response';
import { ChunkedUploadsService } from './chunked-uploads.service';
import {
  ChunkedUploadChunkParamsDto,
  ChunkedUploadParamsDto,
  CreateChunkedUploadDto,
} from './dto/chunked-upload.dto';
import { ChunkedUploadResponse } from './dto/chunked-upload.response';

@ApiTags('Problem editing')
@Controller('api/internal/problems')
export class ChunkedUploadsController {
  constructor(private readonly uploads: ChunkedUploadsService) {}

  /**
   * Start a chunked upload of the test data archive
   *
   * @remarks
   * For archives too large for one request (above `chunkBytes`, 48 MiB). Same
   * rights as the archive upload; mirror problems are refused. `name` must end
   * in `.zip` (400 `zip_required`), `size` is at most 2 GiB. Spends one upload of
   * the 30 per hour per user and checks the organization's storage now (403
   * `quota_exceeded`); credits are charged at complete. At most 2 open uploads per
   * user (409 `upload_sessions_full`); a session expires 24 hours after create.
   */
  @Post(':code/data/uploads')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: CreateChunkedUploadDto,
  ): Promise<ChunkedUploadResponse> {
    return this.uploads.create(auth, code, body);
  }

  /**
   * Send one chunk of a chunked upload
   *
   * @remarks
   * One multipart `file` holding bytes `index * chunkBytes` onwards, exactly
   * `chunkBytes` long (the last chunk: the rest; 400 `chunk_size_mismatch`, 413
   * `file_too_large`). An index past the last chunk is 400
   * `chunk_index_out_of_range`. Sending a chunk again replaces it. Chunks of one
   * upload are written one at a time (409 `busy`). Limited to 300 chunks per hour
   * per user. Another user's upload, or an expired one, is 404 `not_found`.
   */
  @ApiFileUpload()
  @Put(':code/data/uploads/:id/chunks/:index')
  putChunk(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ChunkedUploadChunkParamsDto,
    @Req() request: FastifyRequest,
  ): Promise<ChunkedUploadResponse> {
    return this.uploads.putChunk(auth, target, request);
  }

  /**
   * Get a chunked upload
   *
   * @remarks
   * `received` lists the chunks the server holds; resume by sending the others.
   */
  @Get(':code/data/uploads/:id')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ChunkedUploadParamsDto,
  ): Promise<ChunkedUploadResponse> {
    return this.uploads.status(auth, target);
  }

  /**
   * Complete a chunked upload
   *
   * @remarks
   * Needs every chunk (409 `chunks_missing`). Joins them and checks the size and
   * SHA-256 given at create: a mismatch is 400 `upload_hash_mismatch` and ends
   * the upload. Then stores the archive exactly like the archive upload, with its
   * answer and its errors (zip codes, `quota_exceeded`, 409 `busy`); after such
   * an error the chunks are kept, so complete can be retried or the upload
   * cancelled.
   */
  @Post(':code/data/uploads/:id/complete')
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ChunkedUploadParamsDto,
  ): Promise<ProblemDataResponse> {
    return this.uploads.complete(auth, target);
  }

  /**
   * Cancel a chunked upload
   *
   * @remarks
   * Drops the session and its chunks. Nothing was charged.
   */
  @Delete(':code/data/uploads/:id')
  @HttpCode(204)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param() target: ChunkedUploadParamsDto,
  ): Promise<void> {
    return this.uploads.cancel(auth, target);
  }
}
