import type { OfficialRankingRow } from '@libs/database';
import { IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';
import { OFFICIAL_RANKING_LIMITS } from '../official-ranking';

/** Exactly one of the two: the service refuses both, validation refuses neither. */
export class SetOfficialRankingDto {
  /** CMS export of the ranking; send this or url. */
  @ValidateIf((dto: SetOfficialRankingDto) => dto.url === undefined)
  @IsString()
  @MaxLength(OFFICIAL_RANKING_LIMITS.bytes)
  csv?: string;
  /** URL of an external ranking, http or https; send this or csv. */
  @ValidateIf((dto: SetOfficialRankingDto) => dto.csv === undefined)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url?: string;
}

export class OfficialRankingRowResponse implements OfficialRankingRow {
  /** Place in the official ranking. */
  rank!: number;
  /** Account name of the contestant. */
  username!: string;
  /** Contestant's full name as given in the export. */
  fullName!: string;
  /** Score per problem, in the order of problems. */
  scores!: number[];
  /** Sum of the scores. */
  totalScore!: number;
}

export class OfficialRankingResponse {
  /** URL of an external ranking, or null when rows are stored. */
  url!: string | null;
  /** Problem names in column order. */
  problems!: string[];
  /** Ranking rows; empty for an external ranking. */
  rows!: OfficialRankingRowResponse[];
}
