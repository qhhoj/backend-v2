import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
/** The only files that may name the two settings: the registry that defines them and the helper that reads them. */
const ALLOWED = [
  'libs/settings/src/registry.ts',
  'libs/community/src/official-mode.ts',
];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'test']);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory())
      return SKIPPED_DIRECTORIES.has(name) ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !/\.(e2e-)?spec\.ts$/.test(path)
      ? [path]
      : [];
  });

describe('official mode readers', () => {
  it('has no code reading the mode settings outside the helper', () => {
    const readers = ['apps', 'libs']
      .flatMap((directory) => sourceFiles(join(ROOT, directory)))
      .filter((file) =>
        /contest\.officialMode/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .filter((file) => !ALLOWED.includes(file));
    expect(readers).toEqual([]);
  });
});
