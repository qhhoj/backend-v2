import { IsBoolean, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../core/dto/limits';
import { IsStatementText } from '../../core/dto/statement-text';
import { IsTimestamp } from '../../core/dto/timestamp';

export class PutEditorialDto {
  @IsBoolean() isPublic!: boolean;
  @IsTimestamp() publishOn!: string;
  @IsOptional() @IsUUID('7', { each: true }) authors: string[] = [];
  @IsStatementText() @MaxLength(MAX_MARKDOWN_LENGTH) content!: string;
}
