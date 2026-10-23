import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProblemDto } from './problem-edit.dto';

const LANGUAGE_ID = '01900000-0000-7000-8000-000000000001';

const issuesOf = async (fields: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateProblemDto, fields))).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('allowedLanguages validation', () => {
  it('refuses an empty list with a Vietnamese issue', async () => {
    expect(await issuesOf({ allowedLanguages: [] })).toEqual([
      'Chọn ít nhất 1 ngôn ngữ.',
    ]);
  });

  it('accepts one language and an omitted field', async () => {
    expect(await issuesOf({ allowedLanguages: [LANGUAGE_ID] })).toEqual([]);
    expect(await issuesOf({})).toEqual([]);
  });
});
