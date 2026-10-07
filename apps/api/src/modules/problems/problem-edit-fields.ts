import { isDuplicateKey, AppError, unique } from '@libs/common';
import type { Problem } from '@libs/database';
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

export const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

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

/** DTO → document fields (`date` string → Date); unsent fields and nulls (except where legal) are left out, since `update()` runs no validators. */
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
  if (date) fields.date = new Date(date);
  return fields;
}

/** Runs a write, reporting a duplicate `code` as `validation_failed`. */
export async function withCodeTaken<Result>(
  write: () => Promise<Result>,
): Promise<Result> {
  try {
    return await write();
  } catch (error) {
    throw isDuplicateKey(error, 'code')
      ? new AppError('validation_failed', 400, 'Problem code is taken', {
          code: ['Problem code is taken.'],
        })
      : error;
  }
}
