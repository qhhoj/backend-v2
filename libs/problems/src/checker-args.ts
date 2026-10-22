import type { Checker, Grader, JsonObject } from '@libs/database';

/**
 * The arguments each checker and grader accepts, as the judge reads them. A save is refused with the first
 * problem found, so a bad configuration never reaches the judge as an UNSUPPORTED or failed submission.
 */
type Rule = (value: unknown) => string | null;

const MAX_PRECISION = 20;
const MAX_DISTRIBUTION_LINES = 1000;

const bool: Rule = (value) =>
  typeof value === 'boolean' ? null : 'must be true or false';
const oneOf =
  (...allowed: string[]): Rule =>
  (value) =>
    allowed.includes(value as string)
      ? null
      : `must be one of ${allowed.join(', ')}`;
const precision: Rule = (value) =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= MAX_PRECISION
    ? null
    : `must be a whole number from 0 to ${MAX_PRECISION}`;
const distribution: Rule = (value) => {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > MAX_DISTRIBUTION_LINES
  )
    return `must be a list of 1 to ${MAX_DISTRIBUTION_LINES} weights`;
  if (!value.every((weight) => Number.isInteger(weight) && weight >= 0))
    return 'must hold whole numbers of 0 or more';
  return value.some((weight) => weight > 0)
    ? null
    : 'must hold at least one weight above 0';
};

/** Custom checker kinds the judge grades; cms, coci and peg were never used and are not graded. */
export const GRADED_CUSTOM_CHECKER_TYPES = [
  'testlib',
  'themis',
  'default',
] as const;

const FLOATS: Record<string, Rule> = {
  precision,
  error_mode: oneOf('default', 'absolute', 'relative'),
};

/** Keys the server writes itself for a custom checker; whatever the editor sent for them is dropped. */
const SERVER_SET_CUSTOM_KEYS = ['files', 'lang'];

const CHECKER_RULES: Record<Checker, Record<string, Rule>> = {
  standard: {},
  floats: FLOATS,
  floatsabs: FLOATS,
  floatsrel: FLOATS,
  identical: { pe_allowed: bool },
  linecount: {},
  rstripped: { filter_new_line: bool },
  sorted: { split_on: oneOf('lines', 'whitespace') },
  unordered: {},
  easy: {},
  linematches: {
    point_distribution: distribution,
    filler_lines_required: bool,
  },
  bridged: {
    type: oneOf(...GRADED_CUSTOM_CHECKER_TYPES),
    treat_checker_points_as_percentage: bool,
  },
};

const GRADER_RULES: Record<Grader, Record<string, Rule>> = {
  standard: {
    io_method: oneOf('standard', 'file'),
    io_input_file: (value) =>
      typeof value === 'string' ? null : 'must be text',
    io_output_file: (value) =>
      typeof value === 'string' ? null : 'must be text',
  },
  interactive: { treat_checker_points_as_percentage: bool },
  signature: { allow_main: bool },
  output_only: {},
};

function firstProblem(
  args: JsonObject,
  rules: Record<string, Rule>,
  owner: string,
): string | null {
  for (const [key, value] of Object.entries(args)) {
    const rule = rules[key];
    if (!rule) return `${owner} does not take the argument "${key}".`;
    const problem = rule(value);
    if (problem) return `${owner}: "${key}" ${problem}.`;
  }
  return null;
}

/** Why `args` do not fit `checker`, or null. A custom checker's `files` and `lang` are ignored (the upload sets them). */
export function checkerArgsProblem(
  checker: Checker,
  args: JsonObject | null,
): string | null {
  if (!args) return null;
  const own =
    checker === 'bridged'
      ? Object.fromEntries(
          Object.entries(args).filter(
            ([key]) => !SERVER_SET_CUSTOM_KEYS.includes(key),
          ),
        )
      : args;
  const problem = firstProblem(
    own,
    CHECKER_RULES[checker],
    `The ${checker} checker`,
  );
  if (problem) return problem;
  if (
    checker === 'bridged' &&
    own.treat_checker_points_as_percentage === true &&
    (own.type ?? 'testlib') !== 'testlib'
  )
    return 'Only a testlib checker can treat its points as a percentage.';
  return null;
}

/** Why `args` do not fit `grader`, or null. File names themselves are checked when init.yml is generated. */
export function graderArgsProblem(
  grader: Grader,
  args: JsonObject | null,
): string | null {
  if (!args) return null;
  return firstProblem(args, GRADER_RULES[grader], `The ${grader} grader`);
}
