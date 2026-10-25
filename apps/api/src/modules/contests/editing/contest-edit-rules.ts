import { hasPermission } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { AppError, invalidField, sameJson } from '@libs/common';
import type { Contest } from '@libs/database';

/** Legacy `VNOJ_CONTEST_DURATION_LIMIT`, in whole days (`timedelta.days`). */
const CONTEST_DURATION_LIMIT_DAYS = 14;
const DAY_MS = 86_400_000;

/** Legacy admin `get_readonly_fields`: a request may change these only with the permission. */
const GATED_FIELDS: ReadonlyArray<[keyof Contest, Permission]> = [
  ['isRated', 'judge.contest_rating'],
  ['rateAll', 'judge.contest_rating'],
  ['rateExclude', 'judge.contest_rating'],
  ['ratingFloor', 'judge.contest_rating'],
  ['ratingCeiling', 'judge.contest_rating'],
  ['lockedAfter', 'judge.lock_contest'],
  ['accessCodeHash', 'judge.contest_access_code'],
  ['rankingAccessCodeHash', 'judge.contest_access_code'],
  ['isPrivate', 'judge.create_private_contest'],
  ['privateContestants', 'judge.create_private_contest'],
  ['isOrganizationPrivate', 'judge.create_private_contest'],
  ['organizations', 'judge.create_private_contest'],
];
/** The request field a stored code hash comes from, for the refusal text. */
const CODE_FIELD_NAMES: Partial<Record<keyof Contest, string>> = {
  accessCodeHash: 'accessCode',
  rankingAccessCodeHash: 'rankingAccessCode',
};
/** Stored values of a new contest, to tell which gated fields a create request changes. */
export const CREATE_BASELINE: Partial<Record<keyof Contest, unknown>> = {
  isRated: false,
  rateAll: false,
  rateExclude: [],
  ratingFloor: null,
  ratingCeiling: null,
  lockedAfter: null,
  accessCodeHash: null,
  rankingAccessCodeHash: null,
  isPrivate: false,
  privateContestants: [],
  isOrganizationPrivate: false,
  organizations: [],
  isVisible: false,
};

/** A copied contest's gated fields the principal may not set, at a new contest's values: a clone must not hand out what create refuses. */
export function withUngrantedGatesReset(
  principal: Principal,
  fields: Partial<Contest>,
): Partial<Contest> {
  const reset = GATED_FIELDS.filter(
    ([, permission]) => !hasPermission(principal, permission),
  ).map(([field]): [keyof Contest, unknown] => [field, CREATE_BASELINE[field]]);
  return { ...fields, ...(Object.fromEntries(reset) as Partial<Contest>) };
}

/** Legacy `Contest.clean` and `ContestForm.clean`. */
export function assertWindow(principal: Principal, contest: Contest): void {
  const { startTime, endTime, registrationStart, registrationEnd } = contest;
  if (startTime >= endTime)
    throw invalidField(
      'endTime',
      'The contest must end after it starts.',
      'contest_ends_before_start',
    );
  if (
    registrationStart &&
    registrationEnd &&
    registrationStart >= registrationEnd
  )
    throw invalidField(
      'registrationEnd',
      'Registration must end after it starts.',
      'registration_ends_before_start',
    );
  if (registrationStart && registrationStart >= startTime)
    throw invalidField(
      'registrationStart',
      'Registration must start before the contest.',
      'registration_starts_after_contest',
    );
  if (registrationEnd && registrationEnd >= endTime)
    throw invalidField(
      'registrationEnd',
      'Registration must end before the contest ends.',
      'registration_ends_after_contest',
    );
  const days = Math.floor((endTime.getTime() - startTime.getTime()) / DAY_MS);
  if (
    days > CONTEST_DURATION_LIMIT_DAYS &&
    !hasPermission(principal, 'judge.long_contest_duration')
  )
    throw invalidField(
      'endTime',
      `A contest cannot last longer than ${CONTEST_DURATION_LIMIT_DAYS} days.`,
      'contest_too_long',
    );
}

/** A gate fires only when the request changes the value (legacy `get_readonly_fields`); then the visibility rules. */
export function assertGates(
  principal: Principal,
  fields: Partial<Contest>,
  baseline: Record<string, unknown>,
  merged: Contest,
): void {
  const normalized = fields as Record<string, unknown>;
  const changes = (field: keyof Contest) =>
    normalized[field] !== undefined &&
    !sameJson(normalized[field], baseline[field]);
  for (const [field, permission] of GATED_FIELDS)
    if (changes(field) && !hasPermission(principal, permission))
      throw new AppError(
        'forbidden',
        403,
        `Changing ${CODE_FIELD_NAMES[field] ?? field} requires ${permission}`,
      );
  assertVisibility(principal, fields, baseline, merged);
}

/**
 * Showing a contest to everyone needs `change_contest_visibility`: making it visible (or, for a private one,
 * `create_private_contest`; legacy `save_model`), and opening a visible private contest to everyone.
 */
function assertVisibility(
  principal: Principal,
  fields: Partial<Contest>,
  baseline: Record<string, unknown>,
  merged: Contest,
): void {
  if (hasPermission(principal, 'judge.change_contest_visibility')) return;
  const isPrivate = merged.isPrivate || merged.isOrganizationPrivate;
  if (
    fields.isVisible === true &&
    baseline.isVisible !== true &&
    (!isPrivate || !hasPermission(principal, 'judge.create_private_contest'))
  )
    throw new AppError(
      'forbidden',
      403,
      'Making a contest visible requires judge.change_contest_visibility',
    );
  const wasPrivate =
    baseline.isPrivate === true || baseline.isOrganizationPrivate === true;
  if (merged.isVisible && wasPrivate && !isPrivate)
    throw new AppError(
      'forbidden',
      403,
      'Making a visible private contest public requires judge.change_contest_visibility',
    );
}
