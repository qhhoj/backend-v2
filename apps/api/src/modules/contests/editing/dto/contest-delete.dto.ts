import { IsString, MaxLength } from 'class-validator';

export class ContestDeleteQueryDto {
  /** The contest key typed again, to confirm the delete. */
  @IsString() @MaxLength(100) confirm!: string;
}
