import { LowercaseUuid } from '@libs/common';
import { HEX_SHA256 } from '@libs/database';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CHUNKED_UPLOAD_MAX_BYTES } from '../chunked-upload.limits';

export class CreateChunkedUploadDto {
  /** File name of the archive; it must end in `.zip` (400 `zip_required`) and becomes the archive's name. */
  @IsString() @MaxLength(255) @Matches(/^[^\0]+$/) name!: string;
  /** Size of the whole file in bytes, 1 to 2 GiB. */
  @IsInt() @Min(1) @Max(CHUNKED_UPLOAD_MAX_BYTES) size!: number;
  /** SHA-256 of the whole file, lowercase hex; checked at complete. */
  @Matches(HEX_SHA256) sha256!: string;
}

export class ChunkedUploadParamsDto {
  /** Problem code. */
  @IsString() code!: string;
  /** Upload session id, from create. */
  @LowercaseUuid() @IsUUID('4') id!: string;
}

export class ChunkedUploadChunkParamsDto extends ChunkedUploadParamsDto {
  /** Chunk index, from 0 to `chunkCount - 1`. */
  @Type(() => Number) @IsInt() @Min(0) index!: number;
}
