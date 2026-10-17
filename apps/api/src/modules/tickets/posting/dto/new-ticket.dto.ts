import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';
import {
  TICKET_BODY_MAX_LENGTH,
  TICKET_ISSUE_URL_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from '@libs/community';
import { trim } from '../../../problems/core/dto/transforms';

export class NewTicketMessageDto {
  /** Message text in Markdown. */
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_BODY_MAX_LENGTH)
  body!: string;
}

export class NewTicketDto extends NewTicketMessageDto {
  /** Ticket title. */
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_TITLE_MAX_LENGTH)
  title!: string;
}

/** `http(s)` only: the url becomes a link. */
export class NewGeneralTicketDto extends NewTicketDto {
  /** http or https URL of the page the issue is about. */
  @Transform(trim)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    disallow_auth: true,
  })
  @MaxLength(TICKET_ISSUE_URL_MAX_LENGTH)
  issueUrl!: string;
}

/** A question to a contest's organisers; `problem` narrows it to one of the contest's problems. */
export class NewContestTicketDto extends NewTicketDto {
  /** Code of one of the contest's problems the question is about; omit for the contest as a whole. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  problem?: string;
}
