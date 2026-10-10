import { IsString } from 'class-validator';

/** Unvalidated: an unknown name is a 404. */
export class UsernameParamDto {
  /** Username of the account; an unknown name gives 404. */
  @IsString() username!: string;
}
