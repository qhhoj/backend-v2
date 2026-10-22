import { isDuplicateKey, unique, ValidationFailedError } from '@libs/common';
import type { Problem } from '@libs/database';
import type { ProblemDataFilesService } from '@libs/problems';
import type { UpdateProblemDto } from './dto/problem-edit.dto';

/** The only field a request may set to null (it clears the license). */
const NULLABLE_FIELDS: ReadonlyArray<keyof UpdateProblemDto> = ['licenseId'];
const ID_ARRAY_FIELDS: ReadonlyArray<keyof UpdateProblemDto> = [
  'typeIds',
  'authors',
  'curators',
  'testers',
  'bannedUsers',
  'allowedLanguages',
];

/** Id and limit lists are sets: order never counts as a change. */
export const comparable = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => JSON.stringify(item)).sort()
    : value;

/** Revisions keep the editable source, never the rendered HTML. */
export const withoutRenderedHtml = (
  problem: Record<string, unknown>,
): Record<string, unknown> => ({
  ...problem,
  translations: (
    problem.translations as Problem['translations'] | undefined
  )?.map(({ language, name, description }) => ({
    language,
    name,
    description,
  })),
});

/** DTO → document fields (`date` string → Date, null clears it); unsent fields and nulls (except where legal) are left out, since `update()` runs no validators. */
export function toFields(dto: UpdateProblemDto): Partial<Problem> {
  const { date, ...rest } = dto;
  const fields = Object.fromEntries(
    Object.entries(rest).filter(
      ([field, value]) =>
        value !== undefined &&
        (value !== null ||
          NULLABLE_FIELDS.includes(field as keyof UpdateProblemDto)),
    ),
  ) as Partial<Problem>;
  const record = fields as Record<string, unknown>;
  for (const field of ID_ARRAY_FIELDS) {
    const ids = record[field];
    if (Array.isArray(ids)) record[field] = unique(ids as string[]);
  }
  if (date !== undefined) fields.date = date === null ? null : new Date(date);
  return fields;
}

/** A 400 on field `code` with the stable issue code `code_taken`. */
export const codeTakenError = () =>
  new ValidationFailedError('Problem code is taken', [
    {
      field: 'code',
      code: 'code_taken',
      message: 'Problem code is taken.',
    },
  ]);

/** A 400 on field `code` (issue `data_directory_taken`) when `<code>/` is already on disk: a problem given the code would be judged with, and expose, the tests left there (by a rename whose move failed). */
export async function assertNoDataDirectory(
  dataFiles: Pick<ProblemDataFilesService, 'exists'>,
  code: string,
): Promise<void> {
  if (await dataFiles.exists(code))
    throw new ValidationFailedError('Problem data directory is taken', [
      {
        field: 'code',
        code: 'data_directory_taken',
        message: 'A test data directory for this code already exists.',
      },
    ]);
}

/** Runs a write, reporting a duplicate `code` as `validation_failed`. */
export async function withCodeTaken<Result>(
  write: () => Promise<Result>,
): Promise<Result> {
  try {
    return await write();
  } catch (error) {
    throw isDuplicateKey(error, 'code') ? codeTakenError() : error;
  }
}
