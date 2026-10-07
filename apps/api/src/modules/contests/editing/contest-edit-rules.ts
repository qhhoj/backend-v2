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
  ['isPrivate', 'judge.create_private_contest'],
  ['privateContestants', 'judge.create_private_contest'],
  ['isOrganizationPrivate', 'judge.create_private_contest'],
  ['organizations', 'judge.create_private_contest'],
];
/** Stored values of a new contest, to tell which gated fields a create request changes. */
export const CREATE_BASELINE: Partial<Record<keyof Contest, unknown>> = {
  isRated: false,
  rateAll: false,
  rateExclude: [],
  ratingFloor: null,
  ratingCeiling: null,
  lockedAfter: null,
  accessCodeHash: null,
  isPrivate: false,
  privateContestants: [],
  isOrganizationPrivate: false,
  organizations: [],
  isVisible: false,
};

/** Legacy `Contest.clean` and `ContestForm.clean`. */
export function assertWindow(principal: Principal, contest: Contest): void {
  const { startTime, endTime, registrationStart, registrationEnd } = contest;
  if (startTime >= endTime)
    throw invalidField('endTime', 'The contest must end after it starts.');
  if (
    registrationStart &&
    registrationEnd &&
    registrationStart >= registrationEnd
  )
    throw invalidField(
      'registrationEnd',
      'Registration must end after it starts.',
    );
  if (registrationStart && registrationStart >= startTime)
    throw invalidField(
      'registrationStart',
      'Registration must start before the contest.',
    );
  if (registrationEnd && registrationEnd >= endTime)
    throw invalidField(
      'registrationEnd',
      'Registration must end before the contest ends.',
    );
  const days = Math.floor((endTime.getTime() - startTime.getTime()) / DAY_MS);
  if (
    days > CONTEST_DURATION_LIMIT_DAYS &&
    !hasPermission(principal, 'judge.long_contest_duration')
  )
    throw invalidField(
      'endTime',
      `A contest cannot last longer than ${CONTEST_DURATION_LIMIT_DAYS} days.`,
    );
}

/** A gate fires only when the request changes the value; making a contest visible needs `change_contest_visibility`, or `create_private_contest` for a private one (legacy `save_model`). */
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
        `Changing ${field === 'accessCodeHash' ? 'accessCode' : field} requires ${permission}`,
      );
  if (
    fields.isVisible === true &&
    baseline.isVisible !== true &&
    !hasPermission(principal, 'judge.change_contest_visibility')
  ) {
    const privately = merged.isPrivate || merged.isOrganizationPrivate;
    if (!privately || !hasPermission(principal, 'judge.create_private_contest'))
      throw new AppError(
        'forbidden',
        403,
        'Making a contest visible requires judge.change_contest_visibility',
      );
  }
}
