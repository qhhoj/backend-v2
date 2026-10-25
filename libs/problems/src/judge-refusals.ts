import { canonicalJson } from '@libs/common';
import type {
  CaseChecker,
  CaseType,
  Checker,
  Grader,
  JsonObject,
} from '@libs/database';

interface CheckerChoice {
  checker: Checker | CaseChecker;
  checkerArgs: JsonObject | null;
}

/** Largest `output_limit_length` judge-v2 accepts (`plan.rs` `MAX_OUTPUT_LIMIT`); above it every submission is an internal error. */
export const JUDGE_MAX_OUTPUT_LIMIT = 64 * 1024 * 1024;

/** The part of a data configuration the judge may refuse. */
export interface JudgedSettings extends CheckerChoice {
  grader: Grader;
  generator: string | null;
  nobigmath: boolean;
  outputLimit: number | null;
  cases: (CheckerChoice & { type: CaseType; outputLimit: number | null })[];
}

export interface JudgeRefusal {
  field: string;
  message: string;
}

/** Same checker and arguments whatever the key order; no arguments and `{}` are the same. */
const checkerKey = ({ checker, checkerArgs }: CheckerChoice): string =>
  canonicalJson([checker, checkerArgs ?? {}]);

/** The checker each `C` row is graded with, as init.yml resolves it: its own, else its batch's, else the problem's. */
function caseCheckerKeys(data: JudgedSettings): [number, string][] {
  const keys: [number, string][] = [];
  let batch: CheckerChoice | null = null;
  data.cases.forEach((row, index) => {
    if (row.type === 'S') batch = row.checker ? row : null;
    else if (row.type === 'E') batch = null;
    else keys.push([index, checkerKey(row.checker ? row : (batch ?? data))]);
  });
  return keys;
}

/** Null is the judge default; an explicit 0 or negative limit is refused, as is one above the ceiling. */
const tooLarge = (outputLimit: number | null) =>
  outputLimit !== null &&
  (outputLimit <= 0 || outputLimit > JUDGE_MAX_OUTPUT_LIMIT);
const OUTPUT_LIMIT_MESSAGE = `the judge accepts an output limit of 1 to ${JUDGE_MAX_OUTPUT_LIMIT} bytes (64 MiB); leave it empty for the default.`;

/** An output limit judge-v2 refuses when it plans the cases (`InitError::Invalid`): problem-wide, batch or case; an `E` row emits none. */
function outputLimitRefusal(data: JudgedSettings): JudgeRefusal | null {
  if (tooLarge(data.outputLimit))
    return {
      field: 'outputLimit',
      message: `Output limit: ${OUTPUT_LIMIT_MESSAGE}`,
    };
  const index = data.cases.findIndex(
    (row) => row.type !== 'E' && tooLarge(row.outputLimit),
  );
  if (index < 0) return null;
  return {
    field: `cases.${index}.outputLimit`,
    message: `Case #${index + 1}: ${OUTPUT_LIMIT_MESSAGE}`,
  };
}

/** Cases graded with different checkers; an interactor ignores case checkers. */
function checkerRefusal(data: JudgedSettings): JudgeRefusal | null {
  if (data.grader === 'interactive') return null;
  const keys = caseCheckerKeys(data);
  const differing = keys.find(([, key]) => key !== keys[0][1]);
  if (!differing) return null;
  const [index] = differing;
  return {
    field: `cases.${index}.checker`,
    message: `Case #${index + 1}: the judge grades every case with one checker; give all cases the same checker.`,
  };
}

/**
 * A setting judge-v2 refuses, so every submission would be an internal error: a `generator` and `nobigmath`
 * (init.yml `unsupported_feature`), an output limit above 64 MiB (`plan_cases`), and cases graded with
 * different checkers (grader `single_checker`).
 */
export function judgeRefusal(data: JudgedSettings): JudgeRefusal | null {
  if (data.generator)
    return {
      field: 'generator',
      message: 'The judge does not run test generators; delete the generator.',
    };
  if (data.nobigmath)
    return {
      field: 'nobigmath',
      message: 'The judge does not support nobigmath; turn it off.',
    };
  return outputLimitRefusal(data) ?? checkerRefusal(data);
}
