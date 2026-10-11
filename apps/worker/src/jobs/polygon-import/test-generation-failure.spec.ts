import type { TestGenerationFailure } from '@libs/database';
import type { GenerationPlan } from '@libs/judging';
import { describeGenerationFailure } from './test-generation-failure';

const GIB = 1024 ** 3;
const plan: GenerationPlan = {
  deadlineS: 600,
  limits: {
    generator: { timeS: 10, wallS: 20, memoryKib: 1024 * 1024 },
    validator: { timeS: 10, wallS: 20, memoryKib: 1024 * 1024 },
    solution: { timeS: 4, wallS: 13, memoryKib: 256 * 1024 },
    maxFileBytes: 256 * 1024 ** 2,
    maxTotalBytes: GIB,
    maxUploadBytes: 512 * 1024 ** 2,
  },
  programs: [
    {
      name: 'gen-random',
      role: 'GENERATOR',
      languageKey: 'CPP17',
      sourcePath: 'files/gen-random.cpp',
    },
    {
      name: 'validator',
      role: 'VALIDATOR',
      languageKey: 'CPP17',
      sourcePath: 'files/validator.cpp',
    },
    {
      name: 'sol-main',
      role: 'SOLUTION',
      languageKey: 'CPP17',
      sourcePath: 'solutions/sol-main.cpp',
    },
  ],
  tests: [
    {
      index: 17,
      inputName: '17.inp',
      answerName: '17.out',
      group: 'g1',
      manualPath: '',
      generator: 'gen-random',
      args: ['3', '8', '20', 'query'],
    },
  ],
  inputFile: '',
  outputFile: '',
};

const failure = (
  overrides: Partial<TestGenerationFailure>,
): TestGenerationFailure => ({
  stage: 'GENERATE',
  kind: 'CRASHED',
  program: 'gen-random',
  testIndex: 17,
  detail: '',
  ...overrides,
});
const describeFailure = (overrides: Partial<TestGenerationFailure>) =>
  describeGenerationFailure(failure(overrides), plan);

describe('describeGenerationFailure', () => {
  it.each([
    [
      'a program that does not compile, with the first log lines only',
      {
        stage: 'COMPILE',
        kind: 'COMPILE_ERROR',
        testIndex: 0,
        detail: 'a.cpp:1: error\nl2\nl3\nl4\nl5\nl6\nl7',
      },
      'generator gen-random (files/gen-random.cpp) does not compile: a.cpp:1: error\nl2\nl3\nl4\nl5',
    ],
    [
      'a validator that does not compile',
      {
        stage: 'COMPILE',
        kind: 'COMPILE_ERROR',
        program: 'validator',
        testIndex: 0,
        detail: 'bad',
      },
      'validator validator (files/validator.cpp) does not compile: bad',
    ],
    [
      'a generator that crashes, naming the command',
      { detail: 'exit code 3' },
      'test 17: generator gen-random crashed (exit code 3) on "gen-random 3 8 20 query"',
    ],
    [
      'a generator over its time limit',
      { kind: 'TIME_LIMIT' },
      'test 17: generator gen-random exceeded the time limit (10 s) on "gen-random 3 8 20 query"',
    ],
    [
      'the main solution crashing',
      {
        stage: 'SOLVE',
        program: 'sol-main',
        detail: 'signal SIGSEGV',
      },
      'test 17: main solution sol-main crashed (signal SIGSEGV)',
    ],
    [
      'the main solution over the time limit',
      { stage: 'SOLVE', kind: 'TIME_LIMIT', program: 'sol-main' },
      'test 17: main solution sol-main exceeded the time limit (4 s)',
    ],
    [
      'the main solution over the memory limit',
      { stage: 'SOLVE', kind: 'MEMORY_LIMIT', program: 'sol-main' },
      'test 17: main solution sol-main exceeded the memory limit (256 MiB)',
    ],
    [
      'the validator rejecting a test',
      {
        stage: 'VALIDATE',
        kind: 'REJECTED',
        program: 'validator',
        detail: 'Integer parameter [name=n] equals 0',
      },
      'test 17 (group g1) is rejected by the validator: Integer parameter [name=n] equals 0',
    ],
    [
      'a generator writing too much',
      { kind: 'OUTPUT_LIMIT' },
      'test 17: generator gen-random wrote more than 256 MiB',
    ],
    [
      'all tests together being too big',
      { kind: 'OUTPUT_LIMIT', stage: 'JOB', program: '', testIndex: 0 },
      'the generated tests exceed 1 GiB',
    ],
    [
      'the job running out of time',
      { kind: 'JOB_TIME_LIMIT', stage: 'JOB', program: '', testIndex: 0 },
      'test generation did not finish within 10 minutes',
    ],
    [
      'a lost judge',
      {
        kind: 'INTERNAL',
        stage: 'JOB',
        program: '',
        testIndex: 0,
        detail: 'judge disconnected',
      },
      'the judge disconnected during test generation; sync again',
    ],
    [
      'an internal error of the judge',
      {
        kind: 'INTERNAL',
        stage: 'JOB',
        program: '',
        testIndex: 0,
        detail: 'disk full',
      },
      'test generation failed on the judge: disk full',
    ],
    [
      'a language the judge lacks',
      {
        stage: 'COMPILE',
        kind: 'UNSUPPORTED_LANGUAGE',
        testIndex: 0,
      },
      'generator gen-random uses a language the judge does not support',
    ],
  ])('words %s', (_name, overrides, message) => {
    expect(describeFailure(overrides)).toBe(message);
  });

  it('leaves the group out of a rejection when the test has none, and says so for a missing failure', () => {
    const ungrouped: GenerationPlan = {
      ...plan,
      tests: [{ ...plan.tests[0], group: '' }],
    };
    expect(
      describeGenerationFailure(
        failure({ kind: 'REJECTED', stage: 'VALIDATE', detail: 'no' }),
        ungrouped,
      ),
    ).toBe('test 17 is rejected by the validator: no');
    expect(describeGenerationFailure(null, plan)).toBe(
      'test generation failed',
    );
  });
});
