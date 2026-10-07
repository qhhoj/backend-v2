import { defaultFormat } from './default';
import { finalSubmissionFormat } from './final-submission';
import type {
  ContestFormat,
  FormatConfig,
  FormatName,
  ParticipationScore,
  ScoringContext,
  ScoringRow,
} from './format';
import { icpcFormat } from './icpc';
import { ioiFormat } from './ioi';
import { ioi16Format } from './ioi16';
import { ultimateFormat } from './ultimate';
import { vnojFormat } from './vnoj';

/** The one place a format name maps to its module. */
export const FORMATS: Record<FormatName, ContestFormat> = {
  default: defaultFormat,
  ioi: ioiFormat,
  ioi16: ioi16Format,
  icpc: icpcFormat,
  vnoj: vnojFormat,
  ultimate: ultimateFormat,
  final_submission: finalSubmissionFormat,
};

export interface FormatSetting {
  name: FormatName;
  /** The stored `formatConfig`. */
  config: unknown;
}

export const parseFormatConfig = (
  name: FormatName,
  raw: unknown,
): FormatConfig => FORMATS[name].parseConfig(raw);

/** Legacy `format.update_participation`, pure: the rows are the participation's contest submissions. */
export function scoreParticipation(
  rows: readonly ScoringRow[],
  format: FormatSetting,
  context: ScoringContext,
): ParticipationScore {
  const definition = FORMATS[format.name];
  return definition.score(rows, definition.parseConfig(format.config), context);
}
