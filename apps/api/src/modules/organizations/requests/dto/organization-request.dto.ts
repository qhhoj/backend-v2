import { Transform, Type } from 'class-transformer';
import { trim } from '../../../problems/core/dto/transforms';
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
  /** Why the user wants to join; must not be blank. */
  @IsString()
  @Length(1, REQUEST_REASON_MAX_LENGTH)
  @Matches(/\S/, { message: 'Give a reason.' })
  reason!: string;
}

export class OrganizationRequestListQueryDto {
  /** P pending, A approved or R rejected. */
  @ApiPropertyOptional({
    enum: ORGANIZATION_REQUEST_STATES,
    enumName: 'OrganizationRequestState',
  })
  @IsOptional()
  @IsIn(ORGANIZATION_REQUEST_STATES)
  state: OrganizationRequestState = 'P';
  /** 1-based page number; 50 requests per page. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

export class OrganizationRequestQueueQueryDto extends OrganizationRequestListQueryDto {
  /** Keeps requests whose requester username, or whose organization name, short name or slug, contains this text (any case). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  search?: string;
}

export class DecideOrganizationRequestDto {
  @IsIn(['A', 'R']) state!: 'A' | 'R';
}

export class OrganizationRequestParamsDto {
  /** Slug of the organization. */
  @IsString() slug!: string;
  /** Unvalidated: a malformed id is a 404. */
  @IsString() id!: string;
}
