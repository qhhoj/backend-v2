import { PACKAGE_STATES } from '@libs/problems';
import type { PackageState } from '@libs/problems';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { toBoolean } from '../../core/dto/transforms';
import { PolygonImportQueryDto } from '../../imports/dto/problem-import.dto';

export class PolygonProblemsQueryDto {
  /** Case-insensitive match on id, name, title or owner. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({
    enum: PACKAGE_STATES,
    enumName: 'PolygonPackageState',
  })
  @IsOptional()
  @IsIn(PACKAGE_STATES)
  state?: PackageState;
  /** Skip the 60-second cache; limited per user. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  refresh: boolean = false;
}

export class PolygonProblemParamDto {
  @Type(() => Number) @IsInt() @Min(1) polygonId!: number;
}

/** The zip import's options, as a JSON body, plus the auto-sync switch of the link. */
export class PolygonLinkImportDto extends PolygonImportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoSync: boolean = false;
}
