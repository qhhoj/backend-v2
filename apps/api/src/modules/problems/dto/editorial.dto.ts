import { IsBoolean, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from './limits';
import { IsStatementText } from './statement-text';
import { IsTimestamp } from './timestamp';

export class PutEditorialDto {
  @IsBoolean() isPublic!: boolean;
  @IsTimestamp() publishOn!: string;
  @IsOptional() @IsUUID('7', { each: true }) authors: string[] = [];
  @IsStatementText() @MaxLength(MAX_MARKDOWN_LENGTH) content!: string;
}
