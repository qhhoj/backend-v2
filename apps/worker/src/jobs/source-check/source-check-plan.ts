import type { SourceCheck } from '@libs/database';
import type { GenerationPlan, ProgramLimits } from '@libs/judging';
import { CHECKER_LANGUAGE_BY_EXTENSION, extensionOf } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import type { GenerationEnd } from '../polygon-import/test-generation.service';

/** Never run in a compile check, but the plan carries limits; these match the generators'. */
const UNUSED_LIMITS: ProgramLimits = {
  timeS: 10,
  wallS: 20,
  memoryKib: 1024 * 1024,
};
/** The result of a compile check is an empty zip. */
const MAX_UPLOAD_BYTES = 1024 * 1024;
/** A testlib compile takes about 10 s; the judge allows each helper 60 s wall. */
const DEADLINE_S = 180;
/** Compile logs past this are cut; the first errors are what matters. */
export const MAX_LOG_CHARS = 8000;

const ROLE = { customChecker: 'CHECKER', customGrader: 'INTERACTOR' } as const;
const NAME = { customChecker: 'checker', customGrader: 'interactor' } as const;

/** The compile-only plan for one uploaded checker or interactor, or null when the judge has no compiler for its extension. */
export function compileCheckPlan({
  kind,
  file,
}: Pick<SourceCheckJob, 'kind' | 'file'>): GenerationPlan | null {
  const languageKey = CHECKER_LANGUAGE_BY_EXTENSION[extensionOf(file)];
  if (!languageKey) return null;
  return {
    deadlineS: DEADLINE_S,
    limits: {
      generator: UNUSED_LIMITS,
      validator: UNUSED_LIMITS,
      solution: UNUSED_LIMITS,
      maxFileBytes: MAX_UPLOAD_BYTES,
      maxTotalBytes: MAX_UPLOAD_BYTES,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    },
    programs: [
      { name: NAME[kind], role: ROLE[kind], languageKey, sourcePath: file },
    ],
    tests: [],
    inputFile: '',
    outputFile: '',
  };
}

const UNAVAILABLE: Record<
  Exclude<GenerationEnd['kind'], 'done' | 'failed'>,
  string
> = {
  cancelled: 'the compile check was cancelled',
  timeout: 'the judge did not answer in time',
  'no-judge':
    'no judge online can compile checkers (needs judge-v2 with generate.compile)',
};

/** What a finished run means for the editor: a compile error is the teacher's to fix, anything else is the judges'. */
export function checkOf(
  end: GenerationEnd,
  file: string,
  now = new Date(),
): SourceCheck {
  const check = (status: SourceCheck['status'], log = ''): SourceCheck => ({
    file,
    status,
    log: log.slice(0, MAX_LOG_CHARS),
    checkedAt: now,
  });
  if (end.kind === 'done') return check('ok');
  if (end.kind !== 'failed') return check('unavailable', UNAVAILABLE[end.kind]);
  const { stage, kind, detail } = end.failure;
  if (stage === 'COMPILE' && kind === 'COMPILE_ERROR')
    return check('error', detail);
  return check('unavailable', `${stage} ${kind}${detail ? `: ${detail}` : ''}`);
}
