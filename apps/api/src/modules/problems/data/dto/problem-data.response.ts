import type {
  Checker,
  Grader,
  JsonObject,
  ProblemData,
  ProblemTestCase,
  SourceCheck,
  SourceChecks,
} from '@libs/database';
import { SOFT_TESTCASES } from '../../core/dto/limits';

export class TestCaseResponse implements ProblemTestCase {
  /** `C` normal case, `S` start of a batch, `E` end of a batch. */
  type!: ProblemTestCase['type'];
  /** Input file name. */
  input!: string;
  /** Output file name. */
  output!: string;
  /** Points of the case or batch; null when unscored. */
  points!: number | null;
  /** Whether this case belongs to the pretests. */
  isPretest!: boolean;
  /** Arguments passed to the generator, one per line. */
  generatorArgs!: string;
  /** Per-case checker override; empty for the problem-wide checker. */
  checker!: ProblemTestCase['checker'];
  /** Arguments of the case checker; null for none. */
  checkerArgs!: JsonObject | null;
  /** Leading output bytes kept for display; null for the default. */
  outputPrefix!: number | null;
  /** Largest output accepted, in bytes (`output_limit_length`); null for the default. */
  outputLimit!: number | null;
}

export class ProblemDataLimitsResponse {
  /** Number of cases above which the editor warns; never enforced. */
  softCases!: number;
  /** Most cases the caller may save. */
  maxCases!: number;
}

export class SourceCheckResponse implements SourceCheck {
  /** The uploaded file this check is about. */
  file!: string;
  /** `pending` (queued or compiling on a judge), `ok`, `error` (see `log`) or `unavailable` (no judge with `generate.compile` could compile it; `log` says why). */
  status!: SourceCheck['status'];
  /** Compile log of an `error`, reason of an `unavailable`; empty otherwise. */
  log!: string;
  /** When the judge answered; null while pending. */
  checkedAt!: Date | null;
}

export class SourceChecksResponse implements SourceChecks {
  /** Compile check of the uploaded checker; null when there is none. */
  customChecker!: SourceCheckResponse | null;
  /** Compile check of the uploaded interactor (interactive grader only); null otherwise. */
  customGrader!: SourceCheckResponse | null;
}

export class ProblemDataResponse {
  /** Name of the uploaded test data zip; null when none. */
  archive!: string | null;
  /** Name of the uploaded generator source; null when none. */
  generator!: string | null;
  /** Name of the uploaded checker source; null when none. */
  customChecker!: string | null;
  /** Name of the uploaded grader source; null when none. */
  customGrader!: string | null;
  /** Name of the uploaded header file; null when none. */
  customHeader!: string | null;
  /** Problem-wide checker. */
  checker!: Checker;
  /** Arguments of the checker; null for none. */
  checkerArgs!: JsonObject | null;
  /** Grader. */
  grader!: Grader;
  /** Arguments of the grader; null for none. */
  graderArgs!: JsonObject | null;
  /** Leading output bytes kept for display (`output_prefix_length`); null for the default. */
  outputPrefix!: number | null;
  /** Largest output accepted, in bytes (`output_limit_length`); null for the default. */
  outputLimit!: number | null;
  /** Judge `unicode` flag: output is read as Unicode text. */
  unicode!: boolean;
  /** Judge `nobigmath` flag: big-number arithmetic is off in the checker. */
  nobigmath!: boolean;
  /** Last init.yml generation error, empty when it was written. */
  feedback!: string;
  /** Every test case, in judging order. */
  cases!: TestCaseResponse[];
  /** Members of the archive, for the editor's file pickers; empty when there is no readable archive. */
  archiveFiles!: string[];
  /** Whether an `init.yml` was generated; see `GET /problems/{code}/data/init`. */
  hasInit!: boolean;
  /** Case count limits for the editor. */
  limits!: ProblemDataLimitsResponse;
  /** Compile checks of the uploaded checker and interactor, run on a judge after each upload. */
  sourceChecks!: SourceChecksResponse;

  static from(
    data: ProblemData,
    extra: {
      archiveFiles: string[];
      hasInit: boolean;
      maxCases: number;
      sourceChecks: SourceChecks;
    },
  ): ProblemDataResponse {
    return {
      ...data,
      cases: data.cases.map((row) => ({ ...row })),
      archiveFiles: extra.archiveFiles,
      hasInit: extra.hasInit,
      limits: { softCases: SOFT_TESTCASES, maxCases: extra.maxCases },
      sourceChecks: extra.sourceChecks,
    };
  }
}
