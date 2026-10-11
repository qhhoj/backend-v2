import type { TestGenerationFailure } from '@libs/database';
import {
  GenerationFailure_Kind,
  GenerationFailure_Stage,
  GenerationProgram_Role,
} from '@libs/judge-proto';
import type { GenerateTests, GenerationFailure } from '@libs/judge-proto';
import type { GenerationRole } from '@libs/judging';
import { clipBytes } from '../link/messages';
import { MAX_LOG_BYTES } from '../link/link-limits';
import type { ClaimedGeneration } from './generations.repository';

const ROLE: Record<GenerationRole, GenerationProgram_Role> = {
  GENERATOR: GenerationProgram_Role.ROLE_GENERATOR,
  VALIDATOR: GenerationProgram_Role.ROLE_VALIDATOR,
  SOLUTION: GenerationProgram_Role.ROLE_SOLUTION,
  CHECKER: GenerationProgram_Role.ROLE_CHECKER,
  INTERACTOR: GenerationProgram_Role.ROLE_INTERACTOR,
};

/** `STAGE_COMPILE` -> `COMPILE`; null for UNSPECIFIED and values this build does not know. */
function bareName(name: string | undefined, prefix: string): string | null {
  const bare = name?.startsWith(prefix) ? name.slice(prefix.length) : null;
  return bare === 'UNSPECIFIED' ? null : bare;
}

/** Stage and kind as stored on the row; a value this build does not know becomes the job-level INTERNAL failure. */
export function failureOf(
  failure: GenerationFailure | undefined,
): TestGenerationFailure {
  const stage = bareName(
    GenerationFailure_Stage[failure?.stage ?? 0],
    'STAGE_',
  );
  const kind = bareName(GenerationFailure_Kind[failure?.kind ?? 0], 'KIND_');
  return {
    stage: stage && kind ? stage : 'JOB',
    kind: stage && kind ? kind : 'INTERNAL',
    program: failure?.program ?? '',
    testIndex: failure?.testIndex ?? 0,
    detail: clipBytes(failure?.detail ?? '', MAX_LOG_BYTES),
  };
}

/** A failure the bridge itself decides (deadline, lost judge, missing upload). */
export const jobFailure = (
  kind: 'INTERNAL' | 'JOB_TIME_LIMIT',
  detail: string,
): TestGenerationFailure => ({
  stage: 'JOB',
  kind,
  program: '',
  testIndex: 0,
  detail,
});

/** The plan's role string as the proto enum; throws on a role the worker should never have written. */
function roleOf(role: GenerationRole): GenerationProgram_Role {
  const mapped = ROLE[role];
  if (mapped === undefined) throw new Error(`unknown program role ${role}`);
  return mapped;
}

/** The GenerateTests of a claimed row: the plan maps field for field, only the roles become enums. */
export function generateOf({
  id,
  bundleSize,
  plan,
}: ClaimedGeneration): GenerateTests {
  return {
    generationId: id,
    bundleSize,
    deadlineS: plan.deadlineS,
    limits: plan.limits,
    programs: plan.programs.map((program) => ({
      ...program,
      role: roleOf(program.role),
    })),
    tests: plan.tests,
    inputFile: plan.inputFile,
    outputFile: plan.outputFile,
  };
}
