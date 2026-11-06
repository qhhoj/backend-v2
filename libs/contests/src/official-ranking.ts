import { CsvError, readCsv } from '@libs/common';
import type { OfficialRankingRow } from '@libs/database';

export const OFFICIAL_RANKING_LIMITS = {
  bytes: 1_048_576,
  rows: 10_000,
  columns: 105,
  fieldLength: 200,
} as const;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Any C0 control or DEL; a CSV field holding one is refused by both the ranking and the ghost import. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

const number = (value: string, what: string): number => {
  const trimmed = value.trim();
  const parsed = DECIMAL.test(trimmed) ? Number(trimmed) : NaN;
  // `1e999` passes the pattern and overflows to Infinity.
  if (!Number.isFinite(parsed))
    throw new CsvError(`${what} is not a finite number`);
  return parsed;
};

/** Legacy `parse_csv_ranking` (CMS export). */
export function parseOfficialRanking(csv: string): {
  problems: string[];
  rows: OfficialRankingRow[];
} {
  if (Buffer.byteLength(csv) > OFFICIAL_RANKING_LIMITS.bytes)
    throw new CsvError('The CSV is larger than 1 MiB');
  const [header, ...lines] = readCsv(csv, OFFICIAL_RANKING_LIMITS);
  if (!header) throw new CsvError('The CSV is empty');
  if (header.some((cell) => CONTROL_CHARACTER.test(cell)))
    throw new CsvError('The header holds a control character');
  const column = (name: string) => {
    const position = header.indexOf(name);
    if (position < 0) throw new CsvError(`Missing the ${name} column`);
    return position;
  };
  const [username, fullName, points] = [
    column('Username'),
    column('Full Name'),
    column('Points'),
  ];
  const firstProblem = header.includes('Team') ? 5 : 4;
  const problems = header.slice(firstProblem);
  const rows = lines.map((fields, line) => {
    if (fields.length !== header.length)
      throw new CsvError(
        `Row ${line + 2} has ${fields.length} fields, the header ${header.length}`,
      );
    if (fields.some((field) => CONTROL_CHARACTER.test(field)))
      throw new CsvError(`Row ${line + 2} holds a control character`);
    return {
      username: fields[username],
      fullName: fields[fullName],
      scores: fields
        .slice(firstProblem)
        .map((score) =>
          score.trim() === '' ? 0 : number(score, `A score of row ${line + 2}`),
        ),
      totalScore: number(fields[points], `Points of row ${line + 2}`),
    };
  });
  // Array.prototype.sort is stable, like Python's.
  return {
    problems,
    rows: rows.sort((left, right) => right.totalScore - left.totalScore),
  };
}
