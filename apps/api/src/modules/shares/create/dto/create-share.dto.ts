import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { LowercaseUuid } from '@libs/common';
import { SHARE_TITLE_MAX_LENGTH } from '@libs/database';
import { SHARE_EXPIRIES } from '../../core/share-expiry';
import type { ShareExpiry } from '../../core/share-expiry';
import { PASTE_MAX_BYTES } from '../paste-source';

/** Fields both kinds take. */
class ShareOptionsDto {
  /** Optional plain-text title; control characters are dropped. */
  @IsOptional()
  @IsString()
  @MaxLength(SHARE_TITLE_MAX_LENGTH)
  title?: string;
}

export class CreateSubmissionShareDto extends ShareOptionsDto {
  /** The caller's own finished submission. */
  @LowercaseUuid() @IsUUID('7') submissionId!: string;

  /** How long the link lives; `never` by default. */
  @ApiPropertyOptional({ enum: SHARE_EXPIRIES, enumName: 'ShareExpiry' })
  @IsOptional()
  @IsIn(SHARE_EXPIRIES)
  expiry?: ShareExpiry;
}

export class CreatePasteDto extends ShareOptionsDto {
  /** Language for highlighting and the download's extension; not a file-only one. */
  @LowercaseUuid() @IsUUID('7') languageId!: string;

  /** The code, at most 65536 bytes of UTF-8 (checked by the service, which counts bytes). */
  @IsString()
  @MaxLength(PASTE_MAX_BYTES)
  source!: string;

  /** How long the link lives; `30d` by default. */
  @ApiPropertyOptional({ enum: SHARE_EXPIRIES, enumName: 'ShareExpiry' })
  @IsOptional()
  @IsIn(SHARE_EXPIRIES)
  expiry?: ShareExpiry;
}
