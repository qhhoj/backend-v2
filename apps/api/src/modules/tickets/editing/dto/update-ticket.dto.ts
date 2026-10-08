import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TICKET_ASSIGNEES_MAX, TICKET_NOTES_MAX_LENGTH } from '@libs/community';

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
}
