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

/** Fields of every record; quoted fields may hold commas and quotes (""); a newline is lexed but later refused as a control character. */
class CsvRecordReader {
  private readonly finishedRecords: string[][] = [];
  private record: string[] = [];
  private field = '';
  private isQuoted = false;

  private constructor() {}

  /** A reader holds the state of one text, so it is built per call. */
  static readAll(text: string): string[][] {
    return new CsvRecordReader().read(text);
  }

  private read(text: string): string[][] {
    let index = 0;
    while (index < text.length)
      index += this.isQuoted
        ? this.consumeQuoted(text, index)
        : this.consumePlain(text, index);
    if (this.isQuoted) throw new CsvRankingError('Unterminated quoted field');
    if (this.field !== '' || this.record.length) this.endRecord();
    return this.finishedRecords;
  }

  /** Returns how many characters it consumed (the length). Inside quotes: `""` is one quote, a lone `"` closes the quotes. */
  private consumeQuoted(text: string, index: number): number {
    const char = text[index];
    if (char !== '"') {
      this.field += char;
      return 1;
    }
    if (text[index + 1] === '"') {
      this.field += '"';
      return 2;
    }
    this.isQuoted = false;
    return 1;
  }

  /** Returns how many characters it consumed (the length). Outside quotes: `"` opens an empty field's quotes, `,` ends a field, LF or CRLF ends a record. */
  private consumePlain(text: string, index: number): number {
    const char = text[index];
    if (char === '"' && this.field === '') {
      this.isQuoted = true;
      return 1;
    }
    if (char === ',') {
      this.endField();
      return 1;
    }
    if (char === '\n') {
      this.endRecord();
      return 1;
    }
    if (char === '\r' && text[index + 1] === '\n') {
      this.endRecord();
      return 2;
    }
    this.field += char;
    return 1;
  }

  private endField(): void {
    if (this.field.length > OFFICIAL_RANKING_LIMITS.fieldLength)
      throw new CsvRankingError(
        `A field is longer than ${OFFICIAL_RANKING_LIMITS.fieldLength} characters`,
      );
    this.record.push(this.field);
    this.field = '';
  }

  private endRecord(): void {
    this.endField();
    // A blank line is skipped, like DictReader.
    if (this.record.length === 1 && this.record[0] === '') {
      this.record = [];
      return;
    }
    if (this.record.length > OFFICIAL_RANKING_LIMITS.columns)
      throw new CsvRankingError(
        `More than ${OFFICIAL_RANKING_LIMITS.columns} columns`,
      );
    if (this.finishedRecords.length > OFFICIAL_RANKING_LIMITS.rows)
      throw new CsvRankingError(
        `More than ${OFFICIAL_RANKING_LIMITS.rows} rows`,
      );
    this.finishedRecords.push(this.record);
    this.record = [];
  }
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
  const [header, ...lines] = CsvRecordReader.readAll(
    csv.charCodeAt(0) === BYTE_ORDER_MARK ? csv.slice(1) : csv,
  );
  if (!header) throw new CsvRankingError('The CSV is empty');
  if (header.some((cell) => CONTROL.test(cell)))
    throw new CsvRankingError('The header holds a control character');
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
