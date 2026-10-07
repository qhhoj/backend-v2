import { IsString } from 'class-validator';

/** Unvalidated: a malformed id is a 404. */
export class PostIdParamDto {
  @IsString() id!: string;
}
