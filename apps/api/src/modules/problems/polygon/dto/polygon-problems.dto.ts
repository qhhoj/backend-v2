import { POLYGON_LINK_MAX_LENGTH } from '@libs/problems';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsProblemCode } from '../../core/dto/problem-code.decorator';
import { PolygonImportQueryDto } from '../../imports/dto/problem-import.dto';

/** In the body only, so the link (whose `p…` part is the permission) never lands in a URL or an access log. */
export class PolygonProblemLinkDto {
  /** The problem page address, `https://polygon.codeforces.com/p…/owner/name`. */
  @IsString() @MaxLength(POLYGON_LINK_MAX_LENGTH) link!: string;
  /** The problem the link is for, when re-linking an existing one: it may already hold this link. */
  @IsOptional()
  @IsProblemCode()
  code?: string;
}

/** The zip import's options, as a JSON body, plus the problem link and the auto-sync switch of the link. */
export class PolygonLinkImportDto extends PolygonImportQueryDto {
  /** The problem page address, `https://polygon.codeforces.com/p…/owner/name`. */
  @IsString() @MaxLength(POLYGON_LINK_MAX_LENGTH) link!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoSync: boolean = false;
}
