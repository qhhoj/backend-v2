import type { OfficialRankingRow } from '@libs/database';
import { IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';
import { OFFICIAL_RANKING_LIMITS } from '../official-ranking';

/** Exactly one of the two: the service refuses both, validation refuses neither. */
export class SetOfficialRankingDto {
  @ValidateIf((dto: SetOfficialRankingDto) => dto.url === undefined)
  @IsString()
  @MaxLength(OFFICIAL_RANKING_LIMITS.bytes)
  csv?: string;
  @ValidateIf((dto: SetOfficialRankingDto) => dto.csv === undefined)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url?: string;
}

export class OfficialRankingRowResponse implements OfficialRankingRow {
  rank!: number;
  username!: string;
  fullName!: string;
  scores!: number[];
  totalScore!: number;
}

export class OfficialRankingResponse {
  url!: string | null;
  problems!: string[];
  rows!: OfficialRankingRowResponse[];
}
