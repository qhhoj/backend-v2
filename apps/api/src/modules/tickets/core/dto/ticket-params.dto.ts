import { IsString } from 'class-validator';

/** Unvalidated: a malformed id is a 404. */
export class TicketIdParamDto {
  /** Id of the ticket. */
  @IsString() id!: string;
}

/** Unvalidated: an unknown code is a 404. */
export class TicketProblemParamDto {
  /** Code of the problem. */
  @IsString() code!: string;
}
