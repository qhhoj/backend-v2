import { parseXml } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import {
  buildGenerationPlan,
  deadlineOf,
  solutionLimitsOf,
} from './polygon-generation-plan';
import { languageKeyOf } from './polygon-languages';
import { planTests } from './polygon-tests';

const PLAN_OPTIONS = {
  ignoreZeroPointBatches: false,
  ignoreZeroPointCases: false,
  maxCases: 9999,
};

/** problem.xml of Polygon problem 595937 (revision 3), trimmed to two generated and two manual tests. */
const problemXml = (replacements: Array<[string, string]> = []): string =>
  replacements.reduce(
    (xml, [from, to]) => {
      if (!xml.includes(from)) throw new Error(`fixture lacks ${from}`);
      return xml.replace(from, to);
    },
    `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<problem revision="3" short-name="qhh-disc-ioi">
  <judging input-file="" output-file="" run-count="1">
    <testset name="tests">
      <time-limit>2000</time-limit>
      <memory-limit>268435456</memory-limit>
      <test-count>4</test-count>
      <input-path-pattern>tests/%02d</input-path-pattern>
      <answer-path-pattern>tests/%02d.a</answer-path-pattern>
      <tests>
        <test cmd="gen-random 1 8 20 mixed" group="g1" method="generated" points="1.0"/>
        <test cmd="gen-cancel   2 --mx=5" group="g2" method="generated" points="1.0"/>
        <test group="g1" method="manual" points="0.0"/>
        <test method="manual" points="0.0"/>
      </tests>
      <groups>
        <group feedback-policy="points" name="g1" points="15.0" points-policy="complete-group"/>
        <group feedback-policy="points" name="g2" points="25.0" points-policy="complete-group"/>
      </groups>
    </testset>
  </judging>
  <files>
    <resources>
      <file path="files/testlib.h" type="h.g++"/>
    </resources>
    <executables>
      <executable><source path="files/gen-cancel.cpp" type="cpp.g++17"/></executable>
      <executable><source path="files/gen-random.cpp" type="cpp.g++17"/></executable>
      <executable><source path="files/validator.cpp" type="cpp.g++17"/></executable>
    </executables>
  </files>
  <assets>
    <checker name="std::rcmp6.cpp" type="testlib"><source path="files/check.cpp" type="cpp.g++17"/></checker>
    <validators>
      <validator><source path="files/validator.cpp" type="cpp.gcc14-64-msys2-g++23"/></validator>
    </validators>
    <solutions>
      <solution tag="accepted"><source path="solutions/sol-brute.cpp" type="cpp.g++17"/></solution>
      <solution tag="main"><source path="solutions/sol-main.cpp" type="cpp.g++17"/></solution>
    </solutions>
  </assets>
</problem>`,
  );

const planOf = (
  replacements: Array<[string, string]> = [],
  hasMember: (path: string) => boolean = () => true,
) => {
  const root = parseXml(problemXml(replacements));
  return buildGenerationPlan(root, planTests(root, PLAN_OPTIONS), hasMember);
};

describe('buildGenerationPlan', () => {
  it('turns manual tests into package inputs and generated ones into generator + arguments, in file order', () => {
    const { tests } = planOf();
    expect(tests).toEqual([
      expect.objectContaining({
        index: 1,
        inputName: '01.inp',
        answerName: '01.out',
        group: 'g1',
        generator: 'gen-random',
        args: ['1', '8', '20', 'mixed'],
        manualPath: '',
      }),
      expect.objectContaining({
        index: 2,
        group: 'g2',
        generator: 'gen-cancel',
        args: ['2', '--mx=5'],
      }),
      expect.objectContaining({
        index: 3,
        group: 'g1',
        manualPath: 'tests/03',
        generator: '',
        args: [],
      }),
      expect.objectContaining({
        index: 4,
        inputName: '04.inp',
        group: '',
        manualPath: 'tests/04',
      }),
    ]);
  });

  it('lists the generators in first-use order, then the first validator and the main solution', () => {
    expect(planOf().programs).toEqual([
      {
        name: 'gen-random',
        role: 'GENERATOR',
        languageKey: 'CPP17',
        sourcePath: 'files/gen-random.cpp',
      },
      {
        name: 'gen-cancel',
        role: 'GENERATOR',
        languageKey: 'CPP17',
        sourcePath: 'files/gen-cancel.cpp',
      },
      {
        name: 'validator',
        role: 'VALIDATOR',
        languageKey: 'CPP23',
        sourcePath: 'files/validator.cpp',
      },
      {
        name: 'sol-main',
        role: 'SOLUTION',
        languageKey: 'CPP17',
        sourcePath: 'solutions/sol-main.cpp',
      },
    ]);
  });

  it('plans without a validator', () => {
    const programs = planOf([
      [
        '<validators>\n      <validator><source path="files/validator.cpp" type="cpp.gcc14-64-msys2-g++23"/></validator>\n    </validators>',
        '',
      ],
    ]).programs;
    expect(programs.map(({ role }) => role)).toEqual([
      'GENERATOR',
      'GENERATOR',
      'SOLUTION',
    ]);
  });

  it('limits generators and the validator to 10 s / 20 s / 1 GiB and the solution by the problem limits', () => {
    const { limits } = planOf();
    expect(limits.generator).toEqual({
      timeS: 10,
      wallS: 20,
      memoryKib: 1048576,
    });
    expect(limits.validator).toEqual(limits.generator);
    expect(limits.solution).toEqual({ timeS: 4, wallS: 13, memoryKib: 262144 });
    expect(limits).toMatchObject({
      maxFileBytes: 256 * 1024 ** 2,
      maxTotalBytes: 1024 ** 3,
      maxUploadBytes: 512 * 1024 ** 2,
    });
  });

  it('passes the file names only when both are set', () => {
    expect(planOf()).toMatchObject({ inputFile: '', outputFile: '' });
    const both = planOf([
      [
        'input-file="" output-file=""',
        'input-file="in.txt" output-file="out.txt"',
      ],
    ]);
    expect(both).toMatchObject({ inputFile: 'in.txt', outputFile: 'out.txt' });
    const one = planOf([
      ['input-file="" output-file=""', 'input-file="in.txt" output-file=""'],
    ]);
    expect(one).toMatchObject({ inputFile: '', outputFile: '' });
  });

  it.each([
    [
      'an interactive problem',
      [
        [
          '<assets>',
          '<assets><interactor><source path="files/i.cpp" type="cpp.g++17"/></interactor>',
        ],
      ],
      'interactive problems need a full package',
    ],
    [
      'no main solution',
      [['tag="main"', 'tag="accepted"']],
      'no main solution',
    ],
    [
      'an unknown generator',
      [['cmd="gen-random 1', 'cmd="gen-x 1']],
      'generator gen-x not found',
    ],
    [
      'a multi-file generator',
      [
        [
          'method="generated" points="1.0"/>\n        <test cmd="gen-cancel',
          'method="generated" from-file="1" points="1.0"/>\n        <test cmd="gen-cancel',
        ],
      ],
      'multi-file generators are not supported; build a full package',
    ],
    [
      'an unsupported language',
      [
        [
          'solutions/sol-main.cpp" type="cpp.g++17"',
          'solutions/sol-main.cpp" type="cpp.msvc"',
        ],
      ],
      'unsupported language cpp.msvc for solutions/sol-main.cpp',
    ],
    [
      'a generated test without a command',
      [['cmd="gen-cancel   2 --mx=5" ', '']],
      'test 2 has no generator command',
    ],
  ] as Array<[string, Array<[string, string]>, string]>)(
    'refuses %s',
    (_name, replacements, message) => {
      expect(() => planOf(replacements)).toThrow(
        new PolygonImportError(message),
      );
    },
  );

  it('refuses a missing manual input and a missing source', () => {
    expect(() => planOf([], (path) => path !== 'tests/03')).toThrow(
      new PolygonImportError(
        'test 3: manual input tests/03 is missing from the package',
      ),
    );
    expect(() => planOf([], (path) => path !== 'files/validator.cpp')).toThrow(
      new PolygonImportError('files/validator.cpp is missing from the package'),
    );
  });

  it('refuses two programs with one name', () => {
    expect(() =>
      planOf([['solutions/sol-main.cpp', 'files/validator.cpp']]),
    ).toThrow(new PolygonImportError('two programs are named validator'));
  });
});

describe('solution limits and deadline', () => {
  it('gives the solution max(2 x TL, 1 s) CPU and 3 x CPU + 1 s wall', () => {
    expect(solutionLimitsOf(2, 1024)).toEqual({
      timeS: 4,
      wallS: 13,
      memoryKib: 1024,
    });
    expect(solutionLimitsOf(0.25, 1024)).toMatchObject({ timeS: 1, wallS: 4 });
  });

  it('derives the deadline from the test count: the 184-test, 2 s reference package takes 1224 s', () => {
    expect(deadlineOf(184, solutionLimitsOf(2, 1024))).toBe(1224);
  });

  it('caps the deadline at 30 minutes and rounds up', () => {
    expect(deadlineOf(1000, solutionLimitsOf(2, 1024))).toBe(1800);
    expect(deadlineOf(3, solutionLimitsOf(0.3, 1024))).toBe(129);
    expect(deadlineOf(1, { timeS: 0.5, wallS: 1, memoryKib: 1 })).toBe(123);
  });
});

describe('languageKeyOf', () => {
  it.each([
    ['cpp.gcc14-64-msys2-g++23', 'CPP23'],
    ['cpp.gcc13-64-winlibs-g++20', 'CPP20'],
    ['cpp.gcc11-64-winlibs-g++20', 'CPP20'],
    ['cpp.g++17', 'CPP17'],
    ['cpp.g++14', 'CPP14'],
    ['cpp.g++11', 'CPP11'],
    ['cpp.g++', 'CPP17'],
    ['c.gcc', 'C11'],
    ['java8', 'JAVA'],
    ['java11', 'JAVA'],
    ['kotlin', 'KOTLIN'],
    ['python.3', 'PY3'],
    ['python.pypy3', 'PYPY3'],
    ['pas.fpc', 'PAS'],
    ['pascal.fpc', 'PAS'],
    ['delphi', 'PAS'],
  ])('maps %s to %s', (type, key) => {
    expect(languageKeyOf(type, 'a')).toBe(key);
  });

  it.each(['cpp.msvc', 'python.2', 'csharp.mono', 'cpp.g++98', 'perl'])(
    'refuses %s',
    (type) => {
      expect(() => languageKeyOf(type, 'files/a.src')).toThrow(
        new PolygonImportError(`unsupported language ${type} for files/a.src`),
      );
    },
  );
});
