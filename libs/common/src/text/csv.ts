const BYTE_ORDER_MARK = '\uFEFF';

export class CsvError extends Error {}

export interface CsvLimits {
  rows: number;
  columns: number;
  fieldLength: number;
}

/** A spreadsheet runs a cell that starts with one of these as a formula, even after leading whitespace (some importers trim first). */
const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

/** RFC 4180 quoting. */
export const csvQuote = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;

/** One CSV cell: a text cell starting with a formula character gets a `'` before the quoting; numbers and booleans are written as they are, null as empty. */
export function csvCell(value: string | number | boolean | null): string {
  if (typeof value !== 'string') return value === null ? '' : String(value);
  return csvQuote(FORMULA_START.test(value) ? `'${value}` : value);
}

export const csvLine = (
  cells: ReadonlyArray<string | number | boolean | null>,
) => `${cells.map(csvCell).join(',')}\r\n`;

/** Every row as a line ending in CRLF; `bom` puts the mark first, which Excel needs to read UTF-8. */
export const writeCsv = (
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
  { bom = false }: { bom?: boolean } = {},
): string => `${bom ? BYTE_ORDER_MARK : ''}${rows.map(csvLine).join('')}`;

/** Fields of every record; quoted fields may hold commas and quotes (""); a newline is lexed but later refused as a control character. */
class CsvRecordReader {
  private readonly finishedRecords: string[][] = [];
  private record: string[] = [];
  private field = '';
  private isQuoted = false;

  private constructor(private readonly limits: CsvLimits) {}

  /** A reader holds the state of one text, so it is built per call. */
  static readAll(text: string, limits: CsvLimits): string[][] {
    return new CsvRecordReader(limits).read(text);
  }

  private read(text: string): string[][] {
    let index = 0;
    while (index < text.length)
      index += this.isQuoted
        ? this.consumeQuoted(text, index)
        : this.consumePlain(text, index);
    if (this.isQuoted) throw new CsvError('Unterminated quoted field');
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
    if (this.field.length > this.limits.fieldLength)
      throw new CsvError(
        `A field is longer than ${this.limits.fieldLength} characters`,
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
    if (this.record.length > this.limits.columns)
      throw new CsvError(`More than ${this.limits.columns} columns`);
    if (this.finishedRecords.length > this.limits.rows)
      throw new CsvError(`More than ${this.limits.rows} rows`);
    this.finishedRecords.push(this.record);
    this.record = [];
  }
}

/** The records of a CSV text: quotes honoured, the row, column and field caps of `limits`, a leading byte order mark dropped. The byte cap is the caller's. */
export const readCsv = (text: string, limits: CsvLimits): string[][] =>
  CsvRecordReader.readAll(
    text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text,
    limits,
  );
