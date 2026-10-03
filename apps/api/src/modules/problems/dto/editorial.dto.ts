import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from './problem-edit.dto';
import { IsTimestamp } from './timestamp';

export class PutEditorialDto {
  @IsBoolean() isPublic!: boolean;
  @IsTimestamp() publishOn!: string;
  @IsOptional() @IsUUID('7', { each: true }) authors: string[] = [];
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) content!: string;
}
