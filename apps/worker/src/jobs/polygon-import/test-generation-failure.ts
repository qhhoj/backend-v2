import type { TestGenerationFailure } from '@libs/database';
import type {
  GenerationPlan,
  GenerationProgram,
  ProgramLimits,
} from '@libs/judging';
import { shown } from './polygon-package';

const SECONDS_PER_MINUTE = 60;
const KIB_PER_MIB = 1024;
const BYTES_PER_MIB = 1024 * 1024;
const MIB_PER_GIB = 1024;
/** The first lines of a compile log or stderr are enough to find the mistake. */
const SHOWN_LOG_LINES = 5;
const SHOWN_LOG_CHARS = 500;

const ROLE_LABELS: Record<GenerationProgram['role'], string> = {
  GENERATOR: 'generator',
  VALIDATOR: 'validator',
  SOLUTION: 'main solution',
};

/** "generator gen-random", "main solution sol-main"; just the name when the plan does not know the program. */
const labelOf = (plan: GenerationPlan, name: string): string => {
  const program = plan.programs.find((candidate) => candidate.name === name);
  return program ? `${ROLE_LABELS[program.role]} ${program.name}` : shown(name);
};

const firstLines = (text: string): string =>
  text
    .trim()
    .split('\n')
    .slice(0, SHOWN_LOG_LINES)
    .join('\n')
    .slice(0, SHOWN_LOG_CHARS);

/** The program's limits for the stage that ran it. */
const limitsOfStage = (
  plan: GenerationPlan,
  stage: string,
): ProgramLimits | null => {
  if (stage === 'GENERATE') return plan.limits.generator;
  if (stage === 'VALIDATE') return plan.limits.validator;
  if (stage === 'SOLVE') return plan.limits.solution;
  return null;
};

const mib = (kib: number): string => `${kib / KIB_PER_MIB} MiB`;
const bytesText = (bytes: number): string =>
  bytes % (BYTES_PER_MIB * MIB_PER_GIB) === 0
    ? `${bytes / (BYTES_PER_MIB * MIB_PER_GIB)} GiB`
    : `${bytes / BYTES_PER_MIB} MiB`;

/** "test 17: generator gen-random", or just the program when the failure is not about one test. */
const subjectOf = (
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string => {
  const who = labelOf(plan, failure.program);
  return failure.testIndex > 0 ? `test ${failure.testIndex}: ${who}` : who;
};

/** The command line of the failed test: "gen-random 3 8 20 query". */
const commandOf = (plan: GenerationPlan, testIndex: number): string => {
  const test = plan.tests.find((candidate) => candidate.index === testIndex);
  return test?.generator ? [test.generator, ...test.args].join(' ') : '';
};

function compileText(
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string {
  const program = plan.programs.find(({ name }) => name === failure.program);
  const where = program ? ` (${shown(program.sourcePath)})` : '';
  const log = firstLines(failure.detail);
  return `${labelOf(plan, failure.program)}${where} does not compile${log ? `: ${log}` : ''}`;
}

function crashedText(
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string {
  const how = failure.detail ? ` (${firstLines(failure.detail)})` : '';
  const command = commandOf(plan, failure.testIndex);
  const on = failure.stage === 'GENERATE' && command ? ` on "${command}"` : '';
  return `${subjectOf(plan, failure)} crashed${how}${on}`;
}

function timeLimitText(
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string {
  const limit = limitsOfStage(plan, failure.stage)?.timeS;
  const command = commandOf(plan, failure.testIndex);
  const on = failure.stage === 'GENERATE' && command ? ` on "${command}"` : '';
  return `${subjectOf(plan, failure)} exceeded the time limit${limit === undefined ? '' : ` (${limit} s)`}${on}`;
}

function memoryLimitText(
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string {
  const limit = limitsOfStage(plan, failure.stage)?.memoryKib;
  return `${subjectOf(plan, failure)} exceeded the memory limit${limit === undefined ? '' : ` (${mib(limit)})`}`;
}

/** A failure that names no test is the total cap; one that does is a single file over its cap. */
function outputLimitText(
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string {
  if (failure.testIndex <= 0)
    return `the generated tests exceed ${bytesText(plan.limits.maxTotalBytes)}`;
  return `${subjectOf(plan, failure)} wrote more than ${bytesText(plan.limits.maxFileBytes)}`;
}

function rejectedText(
  plan: GenerationPlan,
  failure: TestGenerationFailure,
): string {
  const group = plan.tests.find(
    (test) => test.index === failure.testIndex,
  )?.group;
  const inGroup = group ? ` (group ${shown(group)})` : '';
  const reason = firstLines(failure.detail);
  return `test ${failure.testIndex}${inGroup} is rejected by the validator${reason ? `: ${reason}` : ''}`;
}

const minutesOf = (plan: GenerationPlan): number =>
  Math.ceil(plan.deadlineS / SECONDS_PER_MINUTE);

/** The message when the generation outlives its overall cap; also the worker's own wait cap. */
export const generationTimeoutText = (minutes: number): string =>
  `test generation did not finish within ${minutes} minute${minutes === 1 ? '' : 's'}`;

export const JUDGE_LOST_TEXT =
  'the judge disconnected during test generation; sync again';

function internalText(failure: TestGenerationFailure): string {
  if (/disconnect|lost/i.test(failure.detail)) return JUDGE_LOST_TEXT;
  const detail = firstLines(failure.detail);
  return `test generation failed on the judge${detail ? `: ${detail}` : ''}`;
}

/**
 * The text the requester sees for a failed generation (the judge's or the bridge's structured failure), naming the
 * program, test and limit from the plan. Every judge detail is shortened: it is program output.
 */
export function describeGenerationFailure(
  failure: TestGenerationFailure | null,
  plan: GenerationPlan,
): string {
  if (!failure) return 'test generation failed';
  switch (failure.kind) {
    case 'COMPILE_ERROR':
      return compileText(plan, failure);
    case 'CRASHED':
      return crashedText(plan, failure);
    case 'TIME_LIMIT':
      return timeLimitText(plan, failure);
    case 'MEMORY_LIMIT':
      return memoryLimitText(plan, failure);
    case 'OUTPUT_LIMIT':
      return outputLimitText(plan, failure);
    case 'REJECTED':
      return rejectedText(plan, failure);
    case 'MISSING_FILE':
      return `${subjectOf(plan, failure)} left no ${shown(failure.detail)}`;
    case 'UNSUPPORTED_LANGUAGE':
      return `${labelOf(plan, failure.program)} uses a language the judge does not support`;
    case 'JOB_TIME_LIMIT':
      return generationTimeoutText(minutesOf(plan));
    default:
      return internalText(failure);
  }
}
