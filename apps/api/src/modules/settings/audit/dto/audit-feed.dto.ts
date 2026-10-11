import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class AuditFeedQueryDto {
  /** Keeps one kind of entity (`problem`, `contest`, `blogPost`, `flatpage`, `user`, `comment`, `miscConfig`, ...). */
  @IsOptional() @Matches(/^[A-Za-z]{1,40}$/) entity?: string;

  /** Exact username of the staff member who made the change; unknown matches nothing. */
  @IsOptional() @IsString() @MaxLength(150) actor?: string;

  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

export class AuditEntryResponse {
  /** Revision id. */
  id!: string;
  /** When the change was made, ISO 8601. */
  at!: Date;
  /** Kind of entity changed (`problem`, `contest`, `blogPost`, ...). */
  entity!: string;
  /** Id of the changed entity. */
  entityId!: string;
  /** Its name where one is known (problem code, contest key, post title, page url, username, organization slug, config key); null once it is gone or for kinds without one. */
  label!: string | null;
  /** What was done (`create`, `edit`, `delete`, `hide`, `staff_edit`, ...). */
  action!: string;
  /** Who did it; null for the system or a removed account. */
  actor!: UserSummaryResponse | null;
  /** Names of the changed fields; values are left out (they can hold hidden statements or other private text). */
  fields!: string[];
  /** The change note recorded with it; may be empty. */
  comment!: string;
}
