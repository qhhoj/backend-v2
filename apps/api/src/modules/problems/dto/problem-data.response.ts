import type {
  Checker,
  Grader,
  JsonObject,
  ProblemData,
  ProblemTestCase,
} from '@libs/database';
import { SOFT_TESTCASES } from './limits';

export class TestCaseResponse implements ProblemTestCase {
  type!: ProblemTestCase['type'];
  input!: string;
  output!: string;
  points!: number | null;
  isPretest!: boolean;
  generatorArgs!: string;
  checker!: ProblemTestCase['checker'];
  checkerArgs!: JsonObject | null;
  outputPrefix!: number | null;
  outputLimit!: number | null;
}

export class ProblemDataResponse {
  archive!: string | null;
  generator!: string | null;
  customChecker!: string | null;
  customGrader!: string | null;
  customHeader!: string | null;
  checker!: Checker;
  checkerArgs!: JsonObject | null;
  grader!: Grader;
  graderArgs!: JsonObject | null;
  outputPrefix!: number | null;
  outputLimit!: number | null;
  unicode!: boolean;
  nobigmath!: boolean;
  /** Last init.yml generation error, empty when it was written. */
  feedback!: string;
  cases!: TestCaseResponse[];
  /** Members of the archive, for the editor's file pickers; empty when there is no readable archive. */
  archiveFiles!: string[];
  hasInit!: boolean;
  limits!: { softCases: number; maxCases: number };

  static from(
    data: ProblemData,
    extra: { archiveFiles: string[]; hasInit: boolean; maxCases: number },
  ): ProblemDataResponse {
    return {
      ...data,
      cases: data.cases.map((row) => ({ ...row })),
      archiveFiles: extra.archiveFiles,
      hasInit: extra.hasInit,
      limits: { softCases: SOFT_TESTCASES, maxCases: extra.maxCases },
    };
  }
}
