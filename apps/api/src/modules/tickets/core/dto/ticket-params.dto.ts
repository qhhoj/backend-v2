import { IsString } from 'class-validator';

/** Unvalidated: a malformed id is a 404. */
export class TicketIdParamDto {
  @IsString() id!: string;
}

/** Unvalidated: an unknown code is a 404. */
export class TicketProblemParamDto {
  @IsString() code!: string;
}
