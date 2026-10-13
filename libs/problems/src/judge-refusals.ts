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

/** The part of a data configuration the judge may refuse. */
export interface JudgedSettings extends CheckerChoice {
  grader: Grader;
  nobigmath: boolean;
  cases: (CheckerChoice & { type: CaseType })[];
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

/**
 * A setting judge-v2 refuses as UNSUPPORTED (init.yml `unsupported_feature`, grader `single_checker`), so
 * every submission would be an internal error: `nobigmath` (a Java BigInteger ban it does not enforce) and
 * cases graded with different checkers (it grades a problem with one; an interactor ignores case checkers).
 */
export function judgeRefusal(data: JudgedSettings): JudgeRefusal | null {
  if (data.nobigmath)
    return {
      field: 'nobigmath',
      message: 'The judge does not support nobigmath; turn it off.',
    };
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
