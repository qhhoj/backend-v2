import { parseXml } from '@libs/problems';
import { buildProblemXml } from '../../../test/polygon-fixtures';
import type { PolygonFixture } from '../../../test/polygon-fixtures';
import { headerPathsOf, helperHeadersOf } from './polygon-headers';

const oneTest = { tests: [{ input: '1', answer: '1' }] };
/** problem.xml with these resources, and a package holding every path except `missing`. */
const read = (
  resources: NonNullable<PolygonFixture['resources']>,
  missing: string[] = [],
) => ({
  root: parseXml(buildProblemXml({ ...oneTest, resources })),
  pkg: { has: (path: string) => !missing.includes(path) },
});

describe('headerPathsOf', () => {
  it('lists h.* resources and header-named files the package holds', () => {
    const { root, pkg } = read(
      [
        { path: 'files/testlib.h', type: 'h.g++' },
        { path: 'files/constraints.h' },
        { path: 'files/geometry.hpp' },
        { path: 'files/olymp.sty' },
        { path: 'files/absent.h', type: 'h.g++' },
      ],
      ['files/absent.h'],
    );
    expect(headerPathsOf(root, pkg)).toEqual([
      'files/testlib.h',
      'files/constraints.h',
      'files/geometry.hpp',
    ]);
  });
});

describe('helperHeadersOf', () => {
  it('stages each header under its base name, the first of a repeated name winning', () => {
    const { root, pkg } = read([
      { path: 'files/testlib.h', type: 'h.g++' },
      { path: 'files/lib/constraints.h' },
      { path: 'files/old/testlib.h', type: 'h.g++' },
    ]);
    expect(helperHeadersOf(root, pkg)).toEqual([
      { path: 'files/testlib.h', name: 'testlib.h' },
      { path: 'files/lib/constraints.h', name: 'constraints.h' },
    ]);
  });

  it('leaves out names the import uses itself and names the data directory refuses', () => {
    const { root, pkg } = read([
      { path: 'files/checker.cpp', type: 'h.g++' },
      { path: 'files/init.yml', type: 'h.g++' },
      { path: 'files/a b.h' },
      { path: 'files/a..h' },
      { path: 'files/ok.h' },
    ]);
    expect(helperHeadersOf(root, pkg)).toEqual([
      { path: 'files/ok.h', name: 'ok.h' },
    ]);
  });
});
