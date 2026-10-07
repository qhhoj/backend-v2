import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  ORGANIZATION_REQUEST_STATES,
  REQUEST_REASON_MAX_LENGTH,
} from '@libs/database';
import type { OrganizationRequestState } from '@libs/database';

export class CreateOrganizationRequestDto {
  @IsString()
  @Length(1, REQUEST_REASON_MAX_LENGTH)
  @Matches(/\S/, { message: 'Give a reason.' })
  reason!: string;
}

export class OrganizationRequestListQueryDto {
  @IsOptional()
  @IsIn(ORGANIZATION_REQUEST_STATES)
  state: OrganizationRequestState = 'P';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}

export class DecideOrganizationRequestDto {
  @IsIn(['A', 'R']) state!: 'A' | 'R';
}

export class OrganizationRequestParamsDto {
  @IsString() slug!: string;
  /** Unvalidated: a malformed id is a 404. */
  @IsString() id!: string;
}
