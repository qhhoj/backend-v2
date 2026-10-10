import { INTEGRATION_SCOPES } from '@libs/database';
import type { IntegrationScope } from '@libs/database';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';

export class CreateIntegrationClientDto {
  /** Label to recognise the client, 1-60 characters. */
  @IsString() @Length(1, 60) name!: string;
  // `IntegrationScope` is an alias of a union, so the plugin would drop it: spelled out (SDK R3).
  /** What the client may do: read and/or write the contests it owns. */
  @ApiProperty({
    enum: INTEGRATION_SCOPES,
    enumName: 'IntegrationScope',
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(INTEGRATION_SCOPES, { each: true })
  scopes!: IntegrationScope[];
  /** CIDR blocks the client may call from; each is parsed by the service. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  allowedCidrs!: string[];
  /** Username of the user the client acts as. */
  @IsString() @Length(1, 150) actsAs!: string;
  /** When the key stops working; omitted, it works until revoked. Must be in the future. */
  @IsOptional() @IsTimestamp() expiresAt?: string;
}

export class IntegrationClientListQueryDto {
  /** Page number, starting at 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Clients per page, 1-100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

/** Unvalidated shape: an unknown id is a 404. */
export class IntegrationClientParamDto {
  /** Id of the integration client; an unknown id gives 404. */
  @IsString() id!: string;
}
