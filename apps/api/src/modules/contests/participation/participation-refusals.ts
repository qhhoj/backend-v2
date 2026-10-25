import { AppError } from '@libs/common';

/** Every refusal of register, join and leave, in one table: legacy's distinct cases, each with its own code so the SPA shows its own text (CONTRIBUTING lists them). Statuses: 409 state conflicts, 403 bans and access codes, 404 leaving a contest one is not in. */
const REFUSALS = {
  editor_cannot_register: [409, 'Editors and testers cannot register.'],
  banned_from_contest: [403, 'You are banned from joining this contest.'],
  registration_not_required: [
    409,
    'Registration is not required for this contest.',
  ],
  registration_closed: [409, 'Registration is closed.'],
  contest_ended: [409, 'The contest has ended.'],
  already_registered: [409, 'You have already registered for this contest.'],
  contest_not_started: [409, 'The contest has not started.'],
  virtual_disallowed: [409, 'Virtual joining is not allowed for this contest.'],
  not_registered: [409, 'You are not registered for this contest.'],
  access_code_required: [403, 'This contest needs an access code.'],
  wrong_access_code: [403, 'Wrong access code.'],
  not_in_contest: [404, 'You are not in this contest.'],
} as const satisfies Record<string, readonly [number, string]>;

export type ParticipationRefusal = keyof typeof REFUSALS;

export const refusal = (code: ParticipationRefusal): AppError =>
  new AppError(code, REFUSALS[code][0], REFUSALS[code][1]);

/** 400 with an `issues[]` entry on `acceptRules`, so clients read it like a field error. */
export const rulesNotAccepted = (): AppError => {
  const message = 'Accept the contest rules to take part.';
  return new AppError(
    'rules_not_accepted',
    400,
    message,
    { acceptRules: [message] },
    undefined,
    { issues: [{ field: 'acceptRules', code: 'rules_not_accepted', message }] },
  );
};

/** 409 with an `issues[]` entry on `acceptRulesRevision`: the rules were saved after the contestant opened them. */
export const rulesChanged = (): AppError => {
  const message = 'The contest rules changed; read them again.';
  return new AppError(
    'rules_changed',
    409,
    message,
    { acceptRulesRevision: [message] },
    undefined,
    {
      issues: [
        { field: 'acceptRulesRevision', code: 'rules_changed', message },
      ],
    },
  );
};
