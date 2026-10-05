import { CUSTOM_CHECKER_TYPES, emptyProblemData } from '@libs/database';
import { compileInitYaml } from '@libs/problems';
import { buildProblemXml } from '../../../test/polygon-fixtures';
import { parseAssets } from './polygon-assets';
import { PolygonImportError } from './polygon-import.error';
import { EMPTY_TEST_CASE } from './polygon-tests';
import { parseXml } from './polygon-xml';

const assets = (fixture: Parameters<typeof buildProblemXml>[0]) =>
  parseAssets(parseXml(buildProblemXml(fixture)));
const oneTest = { tests: [{ input: '1', answer: '1' }] };

describe('parseAssets', () => {
  it.each([
    ['std::wcmp.cpp', 'standard', null],
    ['std::hcmp.cpp', 'standard', null],
    ['std::ncmp.cpp', 'standard', null],
    ['std::rcmp4.cpp', 'floats', { precision: 4 }],
    ['std::rcmp6.cpp', 'floats', { precision: 6 }],
    ['std::rcmp9.cpp', 'floats', { precision: 9 }],
    ['std::fcmp.cpp', 'identical', null],
    ['std::lcmp.cpp', 'linecount', null],
  ])('maps %s to the %s checker', (name, checker, checkerArgs) =>
    expect(
      assets({ ...oneTest, checker: { name, path: 'files/check.cpp' } }),
    ).toEqual({
      grader: 'standard',
      checker,
      checkerArgs,
      checkerSource: null,
      interactorSource: null,
    }),
  );

  it('uses a custom C++ checker as bridged testlib, honouring percent points', () => {
    expect(
      assets({ ...oneTest, checker: { path: 'files/check.cpp' } }),
    ).toEqual({
      grader: 'standard',
      checker: 'bridged',
      checkerArgs: { type: 'testlib', lang: 'CPP17' },
      checkerSource: 'files/check.cpp',
      interactorSource: null,
    });
    expect(
      assets({
        ...oneTest,
        checker: { name: 'std::yesno.cpp', path: 'files/check.cpp' },
        judging: { percent: true },
      }).checkerArgs,
    ).toEqual({
      type: 'testlib',
      lang: 'CPP17',
      treat_checker_points_as_percentage: true,
    });
    expect(() =>
      assets({ ...oneTest, checker: { path: 'files/check.py' } }),
    ).toThrow(new PolygonImportError('checker must use C++'));
    expect(() => assets({ ...oneTest, checker: null })).toThrow(
      new PolygonImportError('checker not found'),
    );
  });

  it('prefers the interactor: interactive grader, checker ignored', () => {
    expect(
      assets({
        ...oneTest,
        interactor: 'files/interactor.cpp',
        checker: { path: 'files/check.cpp' },
      }),
    ).toEqual({
      grader: 'interactive',
      checker: 'standard',
      checkerArgs: null,
      checkerSource: null,
      interactorSource: 'files/interactor.cpp',
    });
    expect(() =>
      assets({ ...oneTest, interactor: 'files/interactor.java' }),
    ).toThrow(new PolygonImportError('interactor must use C++'));
  });

  it('produces a custom checker the init.yml compiler accepts, with a type from the known list', () => {
    const parsed = assets({ ...oneTest, checker: { path: 'files/check.cpp' } });
    expect(CUSTOM_CHECKER_TYPES).toContain(parsed.checkerArgs?.type);
    const compiled = compileInitYaml(
      {
        ...emptyProblemData(),
        checker: parsed.checker,
        checkerArgs: parsed.checkerArgs,
        customChecker: 'checker.cpp',
        cases: [
          { ...EMPTY_TEST_CASE, input: '01.inp', output: '01.out', points: 1 },
        ],
      },
      new Set(['01.inp', '01.out']),
    );
    expect(compiled.yaml).toContain('checker.cpp');
    expect(compiled.yaml).toContain('testlib');
  });
});
