import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from './problem-edit.dto';

export class PutEditorialDto {
  @IsBoolean() isPublic!: boolean;
  @IsDateString() publishOn!: string;
  @IsOptional() @IsUUID('7', { each: true }) authors: string[] = [];
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) content!: string;
}
