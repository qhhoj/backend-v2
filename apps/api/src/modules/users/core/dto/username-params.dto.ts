import { IsString } from 'class-validator';

/** Unvalidated: an unknown name is a 404. */
export class UsernameParamDto {
  @IsString() username!: string;
}
