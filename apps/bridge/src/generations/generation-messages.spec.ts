import {
  GenerationFailure_Kind,
  GenerationFailure_Stage,
  GenerationProgram_Role,
} from '@libs/judge-proto';
import type { GenerationPlan } from '@libs/judging';
import { MAX_LOG_BYTES } from '../link/link-limits';
import { failureOf, generateOf, jobFailure } from './generation-messages';

describe('failureOf', () => {
  it.each([
    [
      GenerationFailure_Stage.STAGE_COMPILE,
      GenerationFailure_Kind.KIND_COMPILE_ERROR,
      'COMPILE',
      'COMPILE_ERROR',
    ],
    [
      GenerationFailure_Stage.STAGE_GENERATE,
      GenerationFailure_Kind.KIND_TIME_LIMIT,
      'GENERATE',
      'TIME_LIMIT',
    ],
    [
      GenerationFailure_Stage.STAGE_VALIDATE,
      GenerationFailure_Kind.KIND_REJECTED,
      'VALIDATE',
      'REJECTED',
    ],
    [
      GenerationFailure_Stage.STAGE_SOLVE,
      GenerationFailure_Kind.KIND_MEMORY_LIMIT,
      'SOLVE',
      'MEMORY_LIMIT',
    ],
    [
      GenerationFailure_Stage.STAGE_JOB,
      GenerationFailure_Kind.KIND_JOB_TIME_LIMIT,
      'JOB',
      'JOB_TIME_LIMIT',
    ],
  ])(
    'maps %s/%s to %s/%s without the proto prefix',
    (stage, kind, storedStage, storedKind) => {
      expect(
        failureOf({ stage, kind, program: 'gen', testIndex: 7, detail: 'why' }),
      ).toEqual({
        stage: storedStage,
        kind: storedKind,
        program: 'gen',
        testIndex: 7,
        detail: 'why',
      });
    },
  );

  it.each([
    [
      GenerationFailure_Stage.STAGE_UNSPECIFIED,
      GenerationFailure_Kind.KIND_CRASHED,
    ],
    [
      GenerationFailure_Stage.STAGE_SOLVE,
      GenerationFailure_Kind.KIND_UNSPECIFIED,
    ],
    [GenerationFailure_Stage.UNRECOGNIZED, GenerationFailure_Kind.UNRECOGNIZED],
  ])(
    'stores an unknown stage or kind (%s, %s) as the job-level INTERNAL failure',
    (stage, kind) => {
      expect(
        failureOf({ stage, kind, program: '', testIndex: 0, detail: '' }),
      ).toMatchObject({
        stage: 'JOB',
        kind: 'INTERNAL',
      });
    },
  );

  it('stores a missing failure as INTERNAL and clips a long detail', () => {
    expect(failureOf(undefined)).toMatchObject({
      stage: 'JOB',
      kind: 'INTERNAL',
    });
    const long = failureOf({
      stage: GenerationFailure_Stage.STAGE_VALIDATE,
      kind: GenerationFailure_Kind.KIND_REJECTED,
      program: '',
      testIndex: 1,
      detail: 'x'.repeat(MAX_LOG_BYTES * 2),
    });
    expect(Buffer.byteLength(long.detail)).toBe(MAX_LOG_BYTES);
  });
});

describe('jobFailure', () => {
  it('is a job-level failure about no single test', () => {
    expect(jobFailure('JOB_TIME_LIMIT', 'late')).toEqual({
      stage: 'JOB',
      kind: 'JOB_TIME_LIMIT',
      program: '',
      testIndex: 0,
      detail: 'late',
    });
  });
});

const LIMITS = { timeS: 10, wallS: 20, memoryKib: 1024 };
const PLAN: GenerationPlan = {
  deadlineS: 600,
  limits: {
    generator: LIMITS,
    validator: LIMITS,
    solution: { timeS: 2, wallS: 7, memoryKib: 262144 },
    maxFileBytes: 1000,
    maxTotalBytes: 5000,
    maxUploadBytes: 3000,
  },
  programs: [
    {
      name: 'gen',
      role: 'GENERATOR',
      languageKey: 'CPP17',
      sourcePath: 'files/gen.cpp',
    },
    {
      name: 'val',
      role: 'VALIDATOR',
      languageKey: 'CPP17',
      sourcePath: 'files/val.cpp',
    },
    {
      name: 'sol',
      role: 'SOLUTION',
      languageKey: 'PY3',
      sourcePath: 'sol/main.py',
    },
  ],
  tests: [
    {
      index: 1,
      inputName: '01.inp',
      answerName: '01.out',
      group: '',
      manualPath: 'tests/01',
      generator: '',
      args: [],
    },
    {
      index: 2,
      inputName: '02.inp',
      answerName: '02.out',
      group: 'g1',
      manualPath: '',
      generator: 'gen',
      args: ['3', 'x'],
    },
  ],
  inputFile: '',
  outputFile: '',
};

describe('generateOf', () => {
  it('maps the plan field for field and the role strings to enums', () => {
    const message = generateOf({ id: 'g-1', bundleSize: 99, plan: PLAN });
    expect(message).toMatchObject({
      generationId: 'g-1',
      bundleSize: 99,
      deadlineS: 600,
      limits: PLAN.limits,
      tests: PLAN.tests,
      inputFile: '',
      outputFile: '',
    });
    expect(message.programs.map(({ name, role }) => [name, role])).toEqual([
      ['gen', GenerationProgram_Role.ROLE_GENERATOR],
      ['val', GenerationProgram_Role.ROLE_VALIDATOR],
      ['sol', GenerationProgram_Role.ROLE_SOLUTION],
    ]);
    expect(message.programs[2]).toMatchObject({
      languageKey: 'PY3',
      sourcePath: 'sol/main.py',
    });
  });

  it('refuses a role the worker never writes', () => {
    const plan = {
      ...PLAN,
      programs: [{ ...PLAN.programs[0], role: 'CHECKER' }],
    };
    expect(() =>
      generateOf({ id: 'g', bundleSize: 1, plan: plan as never }),
    ).toThrow(/CHECKER/);
  });
});
