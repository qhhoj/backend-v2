import { ValidationFailedError } from '@libs/common';
import { assertCodeAvailable } from './problem-edit-fields';

const issueCodesOf = async (promise: Promise<void>): Promise<string[]> => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught as ValidationFailedError,
  );
  const issues = (error?.extra?.issues ?? []) as Array<{ code: string }>;
  return issues.map((issue) => issue.code);
};

const available = (hasProblem: boolean, hasDirectory: boolean) =>
  assertCodeAvailable(
    { idByCode: () => Promise.resolve(hasProblem ? 'id' : null) },
    { exists: () => Promise.resolve(hasDirectory) },
    'code',
  );

describe('assertCodeAvailable', () => {
  it('names a live problem first, although its data directory exists too', async () => {
    expect(await issueCodesOf(available(true, true))).toEqual(['code_taken']);
  });

  it('reports a leftover directory when no problem has the code', async () => {
    expect(await issueCodesOf(available(false, true))).toEqual([
      'data_directory_taken',
    ]);
  });

  it('accepts a free code', async () => {
    expect(await issueCodesOf(available(false, false))).toEqual([]);
  });
});
