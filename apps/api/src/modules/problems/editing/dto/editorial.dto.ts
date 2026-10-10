import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../core/dto/limits';
import { IsStatementText } from '../../core/dto/statement-text';
import { IsTimestamp } from '../../core/dto/timestamp';

export class PutEditorialDto {
  /** Whether the editorial is public once `publishOn` has passed. */
  @IsBoolean() isPublic!: boolean;
  /** When the editorial becomes readable (ISO 8601 with offset). */
  @IsTimestamp() publishOn!: string;
  /** Ids of the editorial authors. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7', { each: true })
  authors: string[] = [];
  /** Editorial markdown. */
  @IsStatementText() @MaxLength(MAX_MARKDOWN_LENGTH) content!: string;
}
