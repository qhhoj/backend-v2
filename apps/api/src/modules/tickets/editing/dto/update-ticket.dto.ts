import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  TICKET_ASSIGNEES_MAX,
  TICKET_NOTES_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from '@libs/community';
import { trim } from '../../../problems/core/dto/transforms';

/** Every field is optional; `RefuseNullFieldsPipe` turns an explicit `null` into `must_not_be_null`. */
export class UpdateTicketDto {
  @IsOptional() @IsBoolean() isOpen?: boolean;
  /** `change_ticket` only, never on one's own ticket. */
  @IsOptional() @IsBoolean() isContributive?: boolean;
  /** Assignees and `change_ticket` only; `''` clears. */
  @IsOptional() @IsString() @MaxLength(TICKET_NOTES_MAX_LENGTH) notes?: string;
  /** Usernames; `change_ticket` only. Replaces the list. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TICKET_ASSIGNEES_MAX)
  @IsString({ each: true })
  assignees?: string[];
  /** New title; `change_ticket` only. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_TITLE_MAX_LENGTH)
  title?: string;
  /** Code of the problem to link the ticket to instead (legacy admin relink); `change_ticket` only. */
  @IsOptional() @IsString() @MaxLength(32) problem?: string;
}
