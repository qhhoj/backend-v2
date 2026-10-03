import { Problem } from '@libs/database';
import type { FilterQuery } from 'mongoose';

export const PROBLEM_SORT_FIELDS = [
  'date',
  'code',
  'name',
  'points',
  'acRate',
  'userCount',
] as const;
export const PROBLEM_SORT_OPTIONS = PROBLEM_SORT_FIELDS.flatMap((field) => [
  field,
  `-${field}`,
]);
export const SHORT_QUERY_LENGTH = 3;

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Short queries are prefix matches (the text index only matches whole words); longer ones use the weighted text index. */
export function searchFilter(search: string): FilterQuery<Problem> {
  if (search.length >= SHORT_QUERY_LENGTH)
    return { $text: { $search: search } };
  const prefix = new RegExp(`^${escapeRegex(search)}`, 'i');
  return {
    $or: [{ code: prefix }, { name: prefix }, { 'translations.name': prefix }],
  };
}

export const publicEditorialFilter = (): FilterQuery<Problem> => ({
  'solution.isPublic': true,
  'solution.publishOn': { $lte: new Date() },
});

export function listSort(sort: string): Record<string, 1 | -1> {
  const descending = sort.startsWith('-');
  return {
    [descending ? sort.slice(1) : sort]: descending ? -1 : 1,
    _id: 1,
  };
}
