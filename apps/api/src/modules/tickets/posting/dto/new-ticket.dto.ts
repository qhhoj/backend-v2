import { Transform } from 'class-transformer';
import { IsString, IsUrl, Length, MaxLength } from 'class-validator';
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
