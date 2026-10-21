import { emptyProblemData } from '@libs/database';
import { compileInitYaml } from '@libs/problems';
import { buildProblemXml } from '../../../test/polygon-fixtures';
import { PolygonImportError } from './polygon-import.error';
import { formatPathPattern, planTests } from './polygon-tests';
import type { TestPlan } from './polygon-tests';
import { parseXml } from '@libs/problems';

const options = {
  ignoreZeroPointBatches: false,
  ignoreZeroPointCases: false,
  maxCases: 9999,
};
const plan = (fixture: Parameters<typeof buildProblemXml>[0], overrides = {}) =>
  planTests(parseXml(buildProblemXml(fixture)), { ...options, ...overrides });
const test = (points?: number, group?: string) => ({
  input: 'i',
  answer: 'o',
  points,
  group,
});
const rows = (cases: TestPlan['cases']) =>
  cases.map(
    (row) =>
      `${row.type}${row.points ?? ''}${row.input ? `:${row.input}` : ''}`,
  );
const fixtureXml = (xml: string) => planTests(parseXml(xml), options);
const withTimeLimit = (value: string, points = '1') =>
  `<problem><judging><testset name="tests"><time-limit>${value}</time-limit><memory-limit>1048576</memory-limit><input-path-pattern>t/%d</input-path-pattern><answer-path-pattern>t/%d.a</answer-path-pattern><tests><test points="${points}"/></tests></testset></judging></problem>`;

describe('planTests', () => {
  it('honours the requester testcase limit on distinct tests, not on dependency copies', () => {
    const tests = (count: number) => ({
      tests: Array.from({ length: count }, () => test(1)),
    });
    expect(plan(tests(300), { maxCases: 300 }).tests).toHaveLength(300);
    expect(() => plan(tests(301), { maxCases: 300 })).toThrow(
      new PolygonImportError('too many testcases'),
    );
    const batch = {
      tests: Array.from({ length: 150 }, () => test(1, 'g')),
      groups: [{ name: 'g', points: 10, policy: 'complete-group' as const }],
    };
    expect(plan(batch, { maxCases: 150 }).cases).toHaveLength(152);
    const chain = {
      tests: Array.from({ length: 160 }, (_item, index) =>
        test(0, `g${Math.floor(index / 40)}`),
      ),
      groups: Array.from({ length: 4 }, (_item, index) => ({
        name: `g${index}`,
        points: 25,
        policy: 'complete-group' as const,
        dependencies: index ? [`g${index - 1}`] : [],
      })),
    };
    const chained = plan(chain, { maxCases: 300 });
    expect(chained.tests).toHaveLength(160);
    expect(chained.cases.filter((row) => row.type === 'C')).toHaveLength(
      40 + 80 + 120 + 160,
    );
  });

  it('formats path patterns like printf', () => {
    expect(formatPathPattern('tests/%02d', 7)).toBe('tests/07');
    expect(formatPathPattern('tests/%02d.a', 123)).toBe('tests/123.a');
    expect(formatPathPattern('tests/%d', 7)).toBe('tests/7');
    for (const pattern of [
      'tests/%2147483647d',
      'tests/%99999999d',
      'tests/%010d',
    ])
      expect(() => formatPathPattern(pattern, 7)).toThrow(PolygonImportError);
    expect(() => formatPathPattern('tests/fixed', 7)).toThrow(
      new PolygonImportError('path pattern has no %d'),
    );
  });

  it('converts limits (ms to s, bytes to KB, clamped) and names the repacked files', () => {
    const result = plan({
      tests: [test(), test()],
      timeLimitMs: 2500,
      memoryLimitBytes: 4 * 1024 ** 3,
    });
    expect(result).toMatchObject({
      timeLimit: 2.5,
      memoryLimit: 1048576,
      partial: false,
    });
    expect(result.tests[1]).toEqual({
      index: 1,
      inputPath: 'tests/02',
      answerPath: 'tests/02.a',
      inputName: '02.inp',
      outputName: '02.out',
    });
    expect(rows(result.cases)).toEqual(['C0:01.inp', 'C1:02.inp']);
  });

  it('builds complete-group batches and flattens each-test groups', () => {
    const result = plan({
      tests: [
        test(0, 'g1'),
        test(0, 'g1'),
        test(5, 'g2'),
        test(5, 'g2'),
        test(7),
      ],
      groups: [
        { name: 'g1', points: 30, policy: 'complete-group' },
        { name: 'g2', points: 0, policy: 'each-test' },
      ],
    });
    expect(result.partial).toBe(true);
    expect(rows(result.cases)).toEqual([
      'S30',
      'C:01.inp',
      'C:02.inp',
      'E',
      'C5:03.inp',
      'C5:04.inp',
      'C7:05.inp',
    ]);
  });

  it('folds dependencies and rejects them on each-test groups', () => {
    const result = plan({
      tests: [test(0, 'g1'), test(0, 'g2'), test(0, 'g3')],
      groups: [
        { name: 'g1', points: 10, policy: 'complete-group' },
        {
          name: 'g2',
          points: 20,
          policy: 'complete-group',
          dependencies: ['g1'],
        },
        {
          name: 'g3',
          points: 30,
          policy: 'complete-group',
          dependencies: ['g2'],
        },
      ],
    });
    expect(rows(result.cases)).toEqual([
      'S10',
      'C:01.inp',
      'E',
      'S20',
      'C:01.inp',
      'C:02.inp',
      'E',
      'S30',
      'C:01.inp',
      'C:02.inp',
      'C:03.inp',
      'E',
    ]);
    expect(() =>
      plan({
        tests: [test(1, 'g')],
        groups: [
          { name: 'g', points: 1, policy: 'each-test', dependencies: ['x'] },
        ],
      }),
    ).toThrow(
      new PolygonImportError(
        'dependencies are only supported for batches with complete-group point policy',
      ),
    );
    expect(() =>
      plan({
        tests: [test(1, 'g')],
        groups: [
          {
            name: 'g',
            points: 1,
            policy: 'complete-group',
            dependencies: ['x'],
          },
        ],
      }),
    ).toThrow(new PolygonImportError('unknown dependency group x'));
  });

  it('survives dependency cycles', () => {
    const result = plan({
      tests: [test(0, 'a'), test(0, 'b')],
      groups: [
        { name: 'a', points: 1, policy: 'complete-group', dependencies: ['b'] },
        { name: 'b', points: 1, policy: 'complete-group', dependencies: ['a'] },
      ],
    });
    expect(rows(result.cases)).toEqual([
      'S1',
      'C:01.inp',
      'C:02.inp',
      'E',
      'S1',
      'C:01.inp',
      'C:02.inp',
      'E',
    ]);
  });

  it('normalises fractional points with the gcd', () => {
    const result = plan({
      tests: [test(0.5, 'g1'), test(1.5), test(2.5)],
      groups: [{ name: 'g1', points: 0.5, policy: 'complete-group' }],
    });
    expect(rows(result.cases)).toEqual([
      'S1',
      'C:01.inp',
      'E',
      'C3:02.inp',
      'C5:03.inp',
    ]);
  });

  it('gives the last case one point when nothing scores, and can drop zero-point batches and cases', () => {
    expect(rows(plan({ tests: [test(0), test(0)] }).cases)).toEqual([
      'C0:01.inp',
      'C1:02.inp',
    ]);
    const fixture = {
      tests: [test(0, 'g0'), test(0), test(3)],
      groups: [{ name: 'g0', points: 0, policy: 'complete-group' as const }],
    };
    expect(rows(plan(fixture).cases)).toEqual([
      'C3:03.inp',
      'S0',
      'C:01.inp',
      'E',
      'C0:02.inp',
    ]);
    expect(
      rows(
        plan(fixture, {
          ignoreZeroPointBatches: true,
          ignoreZeroPointCases: true,
        }).cases,
      ),
    ).toEqual(['C3:03.inp']);
  });

  it('puts a 0-point sample case after every scored case, so its failure cannot stop them', () => {
    const aplusb = plan({ tests: [test(0), test(1), test(1), test(1)] });
    expect(rows(aplusb.cases)).toEqual([
      'C1:02.inp',
      'C1:03.inp',
      'C1:04.inp',
      'C0:01.inp',
    ]);
    const exampleGroup = plan({
      tests: [test(0, 'ex'), test(1, 's1'), test(1, 's1')],
      groups: [
        { name: 'ex', points: 0, policy: 'each-test' },
        { name: 's1', points: 2, policy: 'complete-group' },
      ],
    });
    expect(rows(exampleGroup.cases)).toEqual([
      'S2',
      'C:02.inp',
      'C:03.inp',
      'E',
      'C0:01.inp',
    ]);
  });

  it('puts a 0-point samples batch after every scored batch and case', () => {
    const result = plan({
      tests: [
        test(0, 'samples'),
        test(0, 'samples'),
        test(30, 's1'),
        test(0, 's1'),
        test(70, 's2'),
        test(5),
      ],
      groups: [
        { name: 'samples', points: 0, policy: 'complete-group' },
        { name: 's1', points: 30, policy: 'complete-group' },
        {
          name: 's2',
          points: 70,
          policy: 'complete-group',
          dependencies: ['s1'],
        },
      ],
    });
    expect(rows(result.cases)).toEqual([
      'S30',
      'C:03.inp',
      'C:04.inp',
      'E',
      'S70',
      'C:03.inp',
      'C:04.inp',
      'C:05.inp',
      'E',
      'C5:06.inp',
      'S0',
      'C:01.inp',
      'C:02.inp',
      'E',
    ]);
  });

  it('refuses one-sided file io instead of judging it on stdin/stdout', () => {
    expect(() =>
      plan({ tests: [test(1)], judging: { inputFile: 'input.txt' } }),
    ).toThrow(
      new PolygonImportError(
        'Polygon sets only the input file input.txt; QHHOJ needs both I/O files or neither',
      ),
    );
    expect(() =>
      plan({ tests: [test(1)], judging: { outputFile: 'output.txt' } }),
    ).toThrow(
      new PolygonImportError(
        'Polygon sets only the output file output.txt; QHHOJ needs both I/O files or neither',
      ),
    );
  });

  it('refuses rescaled fractional points only for a custom checker that reads them as absolute', () => {
    const fractional = { tests: [test(2.5), test(2.5), test(5)] };
    const custom = { path: 'files/check.cpp' };
    expect(() => plan({ ...fractional, checker: custom })).toThrow(
      /fractional points with a custom checker/,
    );
    expect(
      rows(
        plan({ ...fractional, checker: custom, judging: { percent: true } })
          .cases,
      ),
    ).toEqual(['C1:01.inp', 'C1:02.inp', 'C2:03.inp']);
    expect(
      rows(
        plan({ ...fractional, checker: { name: 'std::rcmp6.cpp', ...custom } })
          .cases,
      ),
    ).toEqual(['C1:01.inp', 'C1:02.inp', 'C2:03.inp']);
    expect(
      rows(plan({ tests: [test(2), test(3)], checker: custom }).cases),
    ).toEqual(['C2:01.inp', 'C3:02.inp']);
  });

  it('reads file io from judging and rejects a testset without tests', () => {
    expect(
      plan({
        tests: [test(1)],
        judging: { inputFile: 'a.inp', outputFile: 'a.out' },
      }).graderArgs,
    ).toEqual({
      io_method: 'file',
      io_input_file: 'a.inp',
      io_output_file: 'a.out',
    });
    expect(plan({ tests: [test(1)] }).graderArgs).toBeNull();
    expect(() => plan({ tests: [] })).toThrow(
      new PolygonImportError('no testcases found'),
    );
  });

  it('never marks a case with a problem-wide-only checker', () => {
    const result = plan({
      tests: [test(1, 'g'), test(2)],
      groups: [{ name: 'g', points: 1, policy: 'complete-group' }],
    });
    expect(
      result.cases.every(
        (row) => row.checker === '' && row.checkerArgs === null,
      ),
    ).toBe(true);
  });

  it.each([
    ['a non-numeric time limit', withTimeLimit('fast'), 'time limit'],
    [
      'a missing time limit',
      withTimeLimit('').replace('<time-limit></time-limit>', ''),
      'time limit',
    ],
    ['non-numeric points', withTimeLimit('1000', 'many'), 'points'],
    ['negative points', withTimeLimit('1000', '-5'), 'points'],
    ['infinite points', withTimeLimit('1000', '1e999'), 'points'],
  ])('rejects %s without hanging', (_label, xml, message) =>
    expect(() => fixtureXml(xml)).toThrow(message),
  );

  it('rejects more tests or groups than a problem may hold, before doing quadratic work', () => {
    const tests = Array.from({ length: 10_000 }, () => test(1));
    expect(() => plan({ tests })).toThrow(
      new PolygonImportError('too many testcases'),
    );
    const groups = Array.from({ length: 1001 }, (_item, index) => ({
      name: `g${index}`,
      points: 1,
      policy: 'complete-group' as const,
    }));
    expect(() => plan({ tests: [test(1)], groups })).toThrow(
      new PolygonImportError('too many groups'),
    );
    const chain = (length: number) => ({
      tests: [test(1)],
      groups: Array.from({ length }, (_item, index) => ({
        name: `g${index}`,
        points: 1,
        policy: 'complete-group' as const,
        dependencies: index ? [`g${index - 1}`] : [],
      })),
    });
    const timed = (work: () => unknown) => {
      const started = performance.now();
      work();
      return Math.max(performance.now() - started, 1);
    };
    const manyTests = (count: number) => ({
      tests: Array.from({ length: count }, () => test(1)),
    });
    plan(manyTests(100));
    // Ten times the tests: linear is ~10x, a quadratic blow-up ~100x.
    expect(timed(() => plan(manyTests(9000)))).toBeLessThan(
      timed(() => plan(manyTests(900))) * 40,
    );
    // Ten times the groups in a dependency chain: the closure is quadratic (~100x) but capped; cubic (~1000x) would break this.
    plan(chain(10));
    expect(timed(() => plan(chain(1000)))).toBeLessThan(
      timed(() => plan(chain(100))) * 300,
    );
  });

  it('rejects a dependency chain that expands past the judge case limit', () => {
    const groups = Array.from({ length: 20 }, (_item, index) => ({
      name: `g${index}`,
      points: 1,
      policy: 'complete-group' as const,
      dependencies: index ? [`g${index - 1}`] : [],
    }));
    const tests = Array.from({ length: 1000 }, (_item, index) =>
      test(0, `g${Math.floor(index / 50)}`),
    );
    expect(() => plan({ tests, groups })).toThrow(
      new PolygonImportError(
        'batches with their dependencies expand to more than 10000 judged cases',
      ),
    );
  });

  it('rejects groups and dependencies without names', () => {
    const xml = (group: string) =>
      withTimeLimit('1000').replace(
        '<tests>',
        `<groups>${group}</groups><tests>`,
      );
    expect(() => fixtureXml(xml('<group points-policy="each-test"/>'))).toThrow(
      'group without a name',
    );
    expect(() =>
      fixtureXml(
        xml(
          '<group name="a" points-policy="complete-group"><dependencies><dependency/></dependencies></group>',
        ),
      ),
    ).toThrow('dependency without a group');
  });

  it('survives 150000 dependencies on one group', () => {
    const dependencies = '<dependency group="a"/>'.repeat(150_000);
    const xml = withTimeLimit('1000').replace(
      '<tests>',
      `<groups><group name="a" points="1" points-policy="complete-group"><dependencies>${dependencies}</dependencies></group></groups><tests>`,
    );
    expect(() => fixtureXml(xml)).not.toThrow(RangeError);
  });

  it('feeds init.yml compilation cleanly: batches, each-test cases and fractional points', () => {
    const result = plan({
      tests: [test(0, 'g1'), test(0, 'g1'), test(0.5, 'g2'), test(1.5)],
      groups: [
        { name: 'g1', points: 2.5, policy: 'complete-group' },
        { name: 'g2', points: 0, policy: 'each-test' },
      ],
    });
    const names = result.tests.flatMap((planned) => [
      planned.inputName,
      planned.outputName,
    ]);
    const compiled = compileInitYaml(
      {
        ...emptyProblemData(),
        cases: result.cases,
        graderArgs: result.graderArgs,
      },
      new Set(names),
    );
    expect(compiled.yaml).toContain('batched');
    expect(
      compiled.cases.filter((row) => row.type === 'S').map((row) => row.points),
    ).toEqual([5]);
    expect(
      compiled.cases
        .filter((row) => row.type === 'C' && row.points !== null)
        .map((row) => row.points),
    ).toEqual([1, 3]);
  });

  it('gives the last batch start one point when only zero-point batches exist', () => {
    expect(
      rows(
        plan({
          tests: [test(0, 'g')],
          groups: [{ name: 'g', points: 0, policy: 'complete-group' }],
        }).cases,
      ),
    ).toEqual(['S1', 'C:01.inp', 'E']);
  });

  it('plans a test naming an unknown group as a plain case', () => {
    expect(rows(plan({ tests: [test(2, 'nope')] }).cases)).toEqual([
      'C2:01.inp',
    ]);
  });

  it('reports a bad points policy before a bad time limit', () => {
    const xml = withTimeLimit('fast').replace(
      '</tests>',
      '</tests><groups><group name="g" points-policy="bogus"/></groups>',
    );
    expect(() => fixtureXml(xml)).toThrow(/unknown points policy/);
  });

  describe('error order when a package has several faults', () => {
    const faulty = ({
      testsXml = '<test group="g" points="1"/>',
      patterns = '<input-path-pattern>t/%d</input-path-pattern><answer-path-pattern>t/%d.a</answer-path-pattern>',
      groupsXml = '<group name="g" points-policy="complete-group"/>',
      timeLimit = '1000',
      memoryLimit = '1048576',
    }) =>
      `<problem><judging><testset name="tests"><time-limit>${timeLimit}</time-limit><memory-limit>${memoryLimit}</memory-limit>${patterns}<tests>${testsXml}</tests><groups>${groupsXml}</groups></testset></judging></problem>`;
    const unknownDependency =
      '<group name="g" points-policy="complete-group"><dependencies><dependency group="missing"/></dependencies></group>';

    it.each([
      [
        'no testcases before missing path patterns',
        { testsXml: '', patterns: '' },
        /no testcases found/,
      ],
      [
        'missing path patterns before a bad group',
        { patterns: '', groupsXml: '<group name="g" points-policy="bogus"/>' },
        /path patterns not found/,
      ],
      [
        'a bad group before bad test points',
        {
          testsXml: '<test points="many"/>',
          groupsXml: '<group name="g" points-policy="bogus"/>',
        },
        /unknown points policy/,
      ],
      [
        'bad test points before an unknown dependency',
        {
          testsXml: '<test group="g" points="many"/>',
          groupsXml: unknownDependency,
        },
        /invalid points of test 1/,
      ],
      [
        'an unknown dependency before a bad time limit',
        { groupsXml: unknownDependency, timeLimit: 'fast' },
        /unknown dependency group/,
      ],
      [
        'a bad time limit before a bad memory limit',
        { timeLimit: 'fast', memoryLimit: 'lots' },
        /invalid time limit/,
      ],
    ])('reports %s', (_label, fault, message) =>
      expect(() => fixtureXml(faulty(fault))).toThrow(message),
    );
  });
});
