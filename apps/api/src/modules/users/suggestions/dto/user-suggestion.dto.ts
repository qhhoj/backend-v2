import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';
import { trim } from '../../../problems/core/dto/transforms';
import { IsUsername } from '../../core/dto/username';

export class UserSuggestionQueryDto {
  /** Case-insensitive username prefix (letters, digits, underscores; 1-30 characters); surrounding spaces are dropped. */
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @IsUsername()
  prefix!: string;
}
