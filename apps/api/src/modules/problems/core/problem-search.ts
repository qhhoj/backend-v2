import { escapeRegExp } from '@libs/common';
import { Problem } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { diacriticInsensitivePattern } from './vietnamese-fold';

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
const MAX_SEARCH_WORDS = 8;

const anyTitleMatches = (pattern: RegExp): FilterQuery<Problem> => ({
  $or: [{ code: pattern }, { name: pattern }, { 'translations.name': pattern }],
});

/**
 * `search`: every whitespace-separated word (first 8) must be a substring of the code or any title,
 * ignoring case and Vietnamese diacritics. A blank query filters nothing (`{}`).
 */
export function searchFilter(search: string): FilterQuery<Problem> {
  const words = search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_WORDS);
  if (words.length === 0) return {};
  return {
    $and: words.map((word) =>
      anyTitleMatches(new RegExp(diacriticInsensitivePattern(word), 'i')),
    ),
  };
}

/** Case-insensitive substring of the code or any title (`q` on the lists); the text is escaped, so it never acts as a pattern. */
export function substringFilter(text: string): FilterQuery<Problem> {
  const inside = new RegExp(escapeRegExp(text), 'i');
  return {
    $or: [{ code: inside }, { name: inside }, { 'translations.name': inside }],
  };
}

/** In-memory twin of `publicEditorialFilter`. */
export const isEditorialPublished = (solution: Problem['solution']): boolean =>
  solution !== null && solution.isPublic && solution.publishOn <= new Date();

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
