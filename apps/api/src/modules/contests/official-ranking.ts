import type { OfficialRankingRow } from '@libs/database';

export const OFFICIAL_RANKING_LIMITS = {
  bytes: 1_048_576,
  rows: 10_000,
  columns: 105,
  fieldLength: 200,
} as const;
export class CsvRankingError extends Error {}

const BYTE_ORDER_MARK = 0xfeff;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Fields of every record; quoted fields may hold commas, quotes ("") and newlines. */
function records(text: string): string[][] {
  const result: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  const endField = () => {
    if (field.length > OFFICIAL_RANKING_LIMITS.fieldLength)
      throw new CsvRankingError(
        `A field is longer than ${OFFICIAL_RANKING_LIMITS.fieldLength} characters`,
      );
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // A blank line is skipped, like DictReader.
    if (record.length === 1 && record[0] === '') return void (record = []);
    if (record.length > OFFICIAL_RANKING_LIMITS.columns)
      throw new CsvRankingError(
        `More than ${OFFICIAL_RANKING_LIMITS.columns} columns`,
      );
    if (result.length > OFFICIAL_RANKING_LIMITS.rows)
      throw new CsvRankingError(
        `More than ${OFFICIAL_RANKING_LIMITS.rows} rows`,
      );
    result.push(record);
    record = [];
  };
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    index += 1;
    if (quoted && char === '"' && next === '"') {
      field += '"';
      index += 1;
    } else if (quoted && char === '"') quoted = false;
    else if (quoted) field += char;
    else if (char === '"' && field === '') quoted = true;
    else if (char === ',') endField();
    else if (char === '\n' || (char === '\r' && next === '\n')) {
      if (char === '\r') index += 1;
      endRecord();
    } else field += char;
  }
  if (quoted) throw new CsvRankingError('Unterminated quoted field');
  if (field !== '' || record.length) endRecord();
  return result;
}

const number = (value: string, what: string): number => {
  const trimmed = value.trim();
  const parsed = DECIMAL.test(trimmed) ? Number(trimmed) : NaN;
  // `1e999` passes the pattern and overflows to Infinity.
  if (!Number.isFinite(parsed))
    throw new CsvRankingError(`${what} is not a finite number`);
  return parsed;
};

/** Legacy `parse_csv_ranking` (CMS export). */
export function parseOfficialRanking(csv: string): {
  problems: string[];
  rows: OfficialRankingRow[];
} {
  if (Buffer.byteLength(csv) > OFFICIAL_RANKING_LIMITS.bytes)
    throw new CsvRankingError('The CSV is larger than 1 MiB');
  const [header, ...lines] = records(
    csv.charCodeAt(0) === BYTE_ORDER_MARK ? csv.slice(1) : csv,
  );
  if (!header) throw new CsvRankingError('The CSV is empty');
  const column = (name: string) => {
    const position = header.indexOf(name);
    if (position < 0) throw new CsvRankingError(`Missing the ${name} column`);
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
      throw new CsvRankingError(
        `Row ${line + 2} has ${fields.length} fields, the header ${header.length}`,
      );
    if (fields.some((field) => CONTROL.test(field)))
      throw new CsvRankingError(`Row ${line + 2} holds a control character`);
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
