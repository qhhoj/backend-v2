import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    enum: ORGANIZATION_REQUEST_STATES,
    enumName: 'OrganizationRequestState',
  })
  @IsOptional()
  @IsIn(ORGANIZATION_REQUEST_STATES)
  state: OrganizationRequestState = 'P';
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

export class DecideOrganizationRequestDto {
  @IsIn(['A', 'R']) state!: 'A' | 'R';
}

export class OrganizationRequestParamsDto {
  @IsString() slug!: string;
  /** Unvalidated: a malformed id is a 404. */
  @IsString() id!: string;
}
