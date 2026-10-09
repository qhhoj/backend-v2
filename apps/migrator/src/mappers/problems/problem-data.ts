import { CASE_CHECKERS, CASE_TYPES, CHECKERS, GRADERS } from '@libs/database';
import type { ProblemData, ProblemTestCase } from '@libs/database';
import { LegacySourceService } from '../../legacy-source.service';
import { groupBy, MapCtx } from '../../mapper';

type DataRow = {
  id: number;
  problem_id: number;
  zipfile: string | null;
  generator: string | null;
  output_prefix: number | null;
  output_limit: number | null;
  feedback: string | null;
  checker: string;
  checker_args: string | null;
  custom_checker: string | null;
  custom_grader: string | null;
  custom_header: string | null;
  grader: string;
  grader_args: string | null;
  nobigmath: number;
  unicode: number;
};
type CaseRow = {
  id: number;
  dataset_id: number;
  type: string;
  input_file: string | null;
  output_file: string | null;
  generator_args: string | null;
  points: number | null;
  is_pretest: number;
  output_prefix: number | null;
  output_limit: number | null;
  checker: string | null;
  checker_args: string | null;
};

/** Legacy FileField `<code>/<file>` as the bare name v2 keeps inside `PROBLEM_DATA_ROOT/<code>/`. */
export function bareName(path: string | null, code: string): string | null {
  if (!path) return null;
  return path.startsWith(`${code}/`)
    ? path.slice(code.length + 1)
    : path.split('/').pop()!;
}

/** A legacy value the v2 enum lacks: the problem's data is not migrated (a fallback would change verdicts on the next editor save). Its message is the report line. */
class UnsupportedValue extends Error {}

/** Legacy checker names v2 maps explicitly: the DMOJ standard checker already ignores trailing whitespace. */
const RENAMED_CHECKERS: Readonly<Record<string, string>> = {
  rstripped: 'standard',
};

function known<Value extends string>(
  value: string | null,
  accepted: readonly Value[],
  where: string,
  renamed: Readonly<Record<string, string>> = {},
): Value {
  const text = value ?? '';
  const mapped = renamed[text] ?? text;
  if ((accepted as readonly string[]).includes(mapped)) return mapped as Value;
  throw new UnsupportedValue(`${where} "${text}" unsupported`);
}

/** `bareName`, reporting a path outside the problem's own folder. */
function fileOf(
  path: string | null,
  code: string,
  where: string,
  ctx: MapCtx,
): string | null {
  if (path?.includes('/') && !path.startsWith(`${code}/`))
    ctx.report(`${where} file outside ${code}/`);
  return bareName(path, code);
}

const objectOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export class ProblemDataSource {
  private data = new Map<number, DataRow[]>();
  private cases = new Map<number, CaseRow[]>();

  async load(source: LegacySourceService): Promise<void> {
    this.data = groupBy(
      await source.query<DataRow>(
        'SELECT * FROM judge_problemdata ORDER BY id',
      ),
      'problem_id',
      (row) => row,
    );
    this.cases = groupBy(
      await source.query<CaseRow>(
        'SELECT * FROM judge_problemtestcase ORDER BY dataset_id, `order`, id',
      ),
      'dataset_id',
      (row) => row,
    );
  }

  dataOf(
    problem: { id: number; code: string },
    ctx: MapCtx,
  ): ProblemData | null {
    const row = this.data.get(problem.id)?.[0];
    const cases = this.cases.get(problem.id) ?? [];
    if (!row && !cases.length) return null;
    try {
      return this.build(problem.code, row, cases, ctx);
    } catch (error) {
      if (!(error instanceof UnsupportedValue)) throw error;
      ctx.report(error.message);
      return null;
    }
  }

  private build(
    code: string,
    row: DataRow | undefined,
    cases: CaseRow[],
    ctx: MapCtx,
  ): ProblemData {
    const where = `judge_problemdata:${row?.id ?? 'none'}`;
    return {
      ...fileFields(row, code, where, ctx),
      ...checkFields(row, where, ctx),
      outputPrefix: row?.output_prefix ?? null,
      outputLimit: row?.output_limit ?? null,
      unicode: ctx.bool(row?.unicode),
      nobigmath: ctx.bool(row?.nobigmath),
      feedback: row?.feedback ?? '',
      cases: cases.map((testCase) => caseOf(testCase, ctx)),
    };
  }
}

function fileFields(
  row: DataRow | undefined,
  code: string,
  where: string,
  ctx: MapCtx,
) {
  const file = (path: string | null | undefined) =>
    fileOf(path ?? null, code, where, ctx);
  return {
    archive: file(row?.zipfile),
    generator: file(row?.generator),
    customChecker: file(row?.custom_checker),
    customGrader: file(row?.custom_grader),
    customHeader: file(row?.custom_header),
  };
}

function checkFields(row: DataRow | undefined, where: string, ctx: MapCtx) {
  return {
    checker: known(
      row?.checker ?? 'standard',
      CHECKERS,
      `${where} checker`,
      RENAMED_CHECKERS,
    ),
    checkerArgs: objectOrNull(
      ctx.json(row?.checker_args, `${where} checker_args`),
    ),
    grader: known(row?.grader ?? 'standard', GRADERS, `${where} grader`),
    graderArgs: objectOrNull(
      ctx.json(row?.grader_args, `${where} grader_args`),
    ),
  };
}

function caseOf(row: CaseRow, ctx: MapCtx): ProblemTestCase {
  const where = `judge_problemtestcase:${row.id}`;
  return {
    type: known(row.type, CASE_TYPES, `${where} type`),
    input: row.input_file ?? '',
    output: row.output_file ?? '',
    points: row.points,
    isPretest: ctx.bool(row.is_pretest),
    generatorArgs: row.generator_args ?? '',
    checker: known(
      row.checker ?? '',
      CASE_CHECKERS,
      `${where} checker`,
      RENAMED_CHECKERS,
    ),
    checkerArgs: objectOrNull(
      ctx.json(row.checker_args, `${where} checker_args`),
    ),
    outputPrefix: row.output_prefix,
    outputLimit: row.output_limit,
  };
}
