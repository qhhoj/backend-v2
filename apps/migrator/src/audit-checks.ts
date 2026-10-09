import {
  CASE_CHECKERS,
  CASE_STATUSES,
  CASE_TYPES,
  CHECKERS,
  CONTEST_FORMAT_NAMES,
  GRADERS,
  ORGANIZATION_REQUEST_STATES,
  RANKING_LINK_EXPIRY_MODES,
  RANKING_LINK_STATUSES,
  SCOREBOARD_VISIBILITIES,
  STATEMENT_LANGUAGES,
  SUBMISSION_RESULTS,
  SUBMISSION_SOURCE_VISIBILITIES,
  SUBMISSION_STATUSES,
  TESTCASE_RESULT_VISIBILITIES,
  TESTCASE_VISIBILITIES,
} from '@libs/database';

const count = (from: string) => `SELECT COUNT(*) total FROM ${from}`;
const notMatching = (table: string, column: string, pattern: string) =>
  count(`\`${table}\` WHERE \`${column}\` NOT REGEXP '(?-i)${pattern}'`);
/** Mongoose `maxlength` counts UTF-16 code units, not characters: an emoji counts 2. */
const utf16Over = (column: string, max: number) =>
  `LENGTH(CONVERT(\`${column}\` USING utf16)) / 2 > ${max}`;
const BOUND = true;
const NOTE = false;

/**
 * [what, SQL returning `total`, bound]: counts only.
 * `bound` lines are rows a v2 schema bound refuses while the mapper keeps them, so `verify` can never reach 0 with them: they are audit errors, and the operator decides before the import (Task 3 Step 6).
 * The other lines are rows a mapper changes, skips or reports: warnings.
 */
export const RANGE_CHECKS: readonly [string, string, boolean][] = [
  [
    'judge_problem.points outside 800..3500 (clamped by the problems job)',
    count('judge_problem WHERE points < 800 OR points > 3500'),
    NOTE,
  ],
  [
    'judge_problem.time_limit outside 0.01..60',
    count('judge_problem WHERE time_limit < 0.01 OR time_limit > 60'),
    BOUND,
  ],
  [
    'judge_problem.memory_limit above 1048576',
    count('judge_problem WHERE memory_limit > 1048576'),
    BOUND,
  ],
  [
    'judge_problem.code outside ^[a-z0-9_]{1,32}$',
    notMatching('judge_problem', 'code', '^[a-z0-9_]{1,32}$'),
    BOUND,
  ],
  [
    'judge_problem without a type',
    count(
      'judge_problem p WHERE NOT EXISTS (SELECT 1 FROM judge_problem_types t WHERE t.problem_id = p.id)',
    ),
    NOTE,
  ],
  [
    'judge_contest.key outside ^[a-z0-9_]{1,32}$',
    notMatching('judge_contest', 'key', '^[a-z0-9_]{1,32}$'),
    BOUND,
  ],
  [
    'judge_contest with more than 100 problems',
    count(
      '(SELECT contest_id FROM judge_contestproblem GROUP BY contest_id HAVING COUNT(*) > 100) x',
    ),
    BOUND,
  ],
  [
    'judge_contest with a Lua label script',
    count("judge_contest WHERE problem_label_script <> ''"),
    NOTE,
  ],
  [
    'judge_contest rated, ended and frozen (never rated by the replay, D3)',
    count(
      "judge_contest WHERE is_rated = 1 AND format_name IN ('icpc', 'vnoj') AND frozen_last_minutes > 0 AND end_time <= NOW()",
    ),
    BOUND,
  ],
  [
    'judge_language.extension outside ^[a-z0-9]{1,10}$',
    notMatching('judge_language', 'extension', '^[a-z0-9]{1,10}$'),
    BOUND,
  ],
  [
    'judge_organization.slug outside ^[A-Za-z][-A-Za-z0-9_]*$',
    notMatching('judge_organization', 'slug', '^[A-Za-z][-A-Za-z0-9_]*$'),
    BOUND,
  ],
  [
    'judge_judge rows (not migrated: judge-v2 registers judges fresh)',
    count('judge_judge'),
    NOTE,
  ],
  [
    'judge_submissiontestcase.status RJ (mapped to IE)',
    count("judge_submissiontestcase WHERE status = 'RJ'"),
    NOTE,
  ],
  [
    'judge_tagproblem.code outside ^[a-zA-Z0-9_]{1,32}$',
    notMatching('judge_tagproblem', 'code', '^[a-zA-Z0-9_]{1,32}$'),
    BOUND,
  ],
  [
    'judge_comment.body over 8192 UTF-16 units',
    count(`judge_comment WHERE ${utf16Over('body', 8192)}`),
    BOUND,
  ],
  [
    'judge_comment.body empty (skipped)',
    count("judge_comment WHERE body = ''"),
    NOTE,
  ],
  [
    'judge_comment visible under a hidden ancestor (hidden by the import, Task 16)',
    'WITH RECURSIVE under_hidden AS (SELECT c.id FROM judge_comment c JOIN judge_comment parent ON parent.id = c.parent_id WHERE parent.hidden = 1 UNION SELECT c.id FROM judge_comment c JOIN under_hidden u ON c.parent_id = u.id) SELECT COUNT(*) total FROM under_hidden u JOIN judge_comment c ON c.id = u.id WHERE c.hidden = 0',
    NOTE,
  ],
  [
    'judge_ticketmessage.body over 8192 UTF-16 units',
    count(`judge_ticketmessage WHERE ${utf16Over('body', 8192)}`),
    BOUND,
  ],
  [
    'judge_ticketmessage.body empty (dropped)',
    count("judge_ticketmessage WHERE TRIM(body) = ''"),
    NOTE,
  ],
  [
    'judge_organizationrequest.reason over 4096 UTF-16 units',
    count(`judge_organizationrequest WHERE ${utf16Over('reason', 4096)}`),
    BOUND,
  ],
  [
    'judge_organizationrequest.reason empty (skipped)',
    count("judge_organizationrequest WHERE TRIM(reason) = ''"),
    NOTE,
  ],
  [
    'judge_organizationrequest repeated pending requests (later ones skipped)',
    "SELECT COUNT(*) - COUNT(DISTINCT organization_id, user_id) total FROM judge_organizationrequest WHERE state = 'P' AND TRIM(reason) <> ''",
    NOTE,
  ],
  [
    'judge_organization_admins who are not members',
    count(
      'judge_organization_admins a WHERE NOT EXISTS (SELECT 1 FROM judge_profile_organizations m WHERE m.profile_id = a.profile_id AND m.organization_id = a.organization_id)',
    ),
    NOTE,
  ],
  [
    'judge_commentvote.score not -1/1',
    count('judge_commentvote WHERE score NOT IN (-1, 1)'),
    NOTE,
  ],
  [
    'judge_blogvote.score not -1/1',
    count('judge_blogvote WHERE score NOT IN (-1, 1)'),
    NOTE,
  ],
  [
    'judge_commentlock pages locked twice (later locks skipped)',
    count(
      '(SELECT page FROM judge_commentlock GROUP BY page HAVING COUNT(*) > 1) x',
    ),
    NOTE,
  ],
  [
    'judge_contestpublicrankinglink contests with more than one link',
    count(
      '(SELECT contest_id FROM judge_contestpublicrankinglink GROUP BY contest_id HAVING COUNT(*) > 1) x',
    ),
    BOUND,
  ],
  [
    'social_auth_usersocialauth repeated (provider, uid)',
    'SELECT COUNT(*) - COUNT(DISTINCT provider, uid) total FROM social_auth_usersocialauth',
    BOUND,
  ],
  [
    'judge_webauthncredential repeated cred_id',
    'SELECT COUNT(*) - COUNT(DISTINCT cred_id) total FROM judge_webauthncredential',
    BOUND,
  ],
  [
    'judge_contestpublicrankinglink.token outside ^[A-Za-z0-9]{18}$',
    notMatching('judge_contestpublicrankinglink', 'token', '^[A-Za-z0-9]{18}$'),
    BOUND,
  ],
  [
    'judge_ticket with more than 500 messages',
    count(
      '(SELECT ticket_id FROM judge_ticketmessage GROUP BY ticket_id HAVING COUNT(*) > 500) x',
    ),
    NOTE,
  ],
  [
    'judge_submission with more than 10000 test cases',
    count(
      '(SELECT submission_id FROM judge_submissiontestcase GROUP BY submission_id HAVING COUNT(*) > 10000) x',
    ),
    NOTE,
  ],
  [
    'judge_submissionsource.source over 65536 UTF-16 units',
    count(`judge_submissionsource WHERE ${utf16Over('source', 65536)}`),
    BOUND,
  ],
  [
    'judge_submissionsource.source empty',
    count("judge_submissionsource WHERE source = ''"),
    BOUND,
  ],
  ['judge_ticket.title empty', count("judge_ticket WHERE title = ''"), BOUND],
  [
    'judge_organization.short_name empty',
    count("judge_organization WHERE short_name = ''"),
    BOUND,
  ],
  [
    'judge_blogpost.title empty',
    count("judge_blogpost WHERE title = ''"),
    BOUND,
  ],
  [
    'judge_blogpost.content empty',
    count("judge_blogpost WHERE content = ''"),
    BOUND,
  ],
  [
    'judge_contestannouncement.title empty',
    count("judge_contestannouncement WHERE title = ''"),
    BOUND,
  ],
  ['judge_problem.name empty', count("judge_problem WHERE name = ''"), BOUND],
  [
    'judge_problemtranslation.name empty',
    count("judge_problemtranslation WHERE name = ''"),
    BOUND,
  ],
  [
    'judge_problemtype or judge_problemgroup full_name empty',
    count(
      "(SELECT full_name FROM judge_problemtype UNION ALL SELECT full_name FROM judge_problemgroup) x WHERE full_name = ''",
    ),
    BOUND,
  ],
  [
    'judge_tagproblem.name or link empty',
    count("judge_tagproblem WHERE name = '' OR link = ''"),
    BOUND,
  ],
  ['judge_license.name empty', count("judge_license WHERE name = ''"), BOUND],
  ['judge_contest.name empty', count("judge_contest WHERE name = ''"), BOUND],
  [
    'judge_language.ace or pygments empty',
    count("judge_language WHERE ace = '' OR pygments = ''"),
    BOUND,
  ],
  [
    'judge_submissionsource file-only sources (rewritten under MEDIA_URL)',
    count("judge_submissionsource WHERE source LIKE '/submission_file/%'"),
    NOTE,
  ],
  [
    'judge_problem.problem_material set (rewritten under MEDIA_URL)',
    count(
      "judge_problem WHERE problem_material IS NOT NULL AND problem_material <> ''",
    ),
    NOTE,
  ],
  [
    'judge_problem.pdf_url not http(s)',
    count("judge_problem WHERE pdf_url <> '' AND pdf_url NOT LIKE 'http%'"),
    NOTE,
  ],
  [
    'auth_user deactivated, not pending (migrated as banned, D4)',
    count(
      "auth_user u LEFT JOIN judge_profile p ON p.user_id = u.id LEFT JOIN registration_registrationprofile r ON r.user_id = u.id WHERE u.is_active = 0 AND COALESCE(p.ban_reason, '') = '' AND COALESCE(r.activated, 1) = 1",
    ),
    NOTE,
  ],
  [
    'judge_profile_badges rows (dropped, D6)',
    count('judge_profile_badges'),
    NOTE,
  ],
  [
    'judge_rating rows (not migrated; re-rated by the replay, D3)',
    count('judge_rating'),
    NOTE,
  ],
  [
    'judge_externalsubmission rows (not migrated)',
    count('judge_externalsubmission'),
    NOTE,
  ],
  ['judge_url rows (not migrated until B8)', count('judge_url'), NOTE],
  ['django_redirect rows (not migrated)', count('django_redirect'), NOTE],
];

/** [table, column, accepted values]: legacy values outside the v2 enum are printed (enum codes, never row data). `rstripped` is accepted because Task 10 maps it to `standard` explicitly (the DMOJ standard checker already ignores trailing whitespace); any other checker or grader outside the enum fails its problem's data (Task 10). */
export const ENUM_CHECKS: readonly [string, string, readonly string[]][] = [
  ['judge_contest', 'format_name', [...CONTEST_FORMAT_NAMES, 'Ultimate']],
  ['judge_contest', 'scoreboard_visibility', SCOREBOARD_VISIBILITIES],
  ['judge_submission', 'status', SUBMISSION_STATUSES],
  ['judge_submission', 'result', [...SUBMISSION_RESULTS, '']],
  ['judge_submissiontestcase', 'status', [...CASE_STATUSES, 'RJ']],
  ['judge_problemdata', 'checker', [...CHECKERS, 'rstripped']],
  ['judge_problemdata', 'grader', GRADERS],
  ['judge_problemtestcase', 'checker', [...CASE_CHECKERS, 'rstripped']],
  ['judge_problemtestcase', 'type', CASE_TYPES],
  ['judge_problemtranslation', 'language', STATEMENT_LANGUAGES],
  [
    'judge_problem',
    'submission_source_visibility_mode',
    SUBMISSION_SOURCE_VISIBILITIES,
  ],
  ['judge_problem', 'testcase_visibility_mode', TESTCASE_VISIBILITIES],
  [
    'judge_problem',
    'testcase_result_visibility_mode',
    TESTCASE_RESULT_VISIBILITIES,
  ],
  ['judge_contestpublicrankinglink', 'status', RANKING_LINK_STATUSES],
  ['judge_contestpublicrankinglink', 'expiry_mode', RANKING_LINK_EXPIRY_MODES],
  ['judge_organizationrequest', 'state', ORGANIZATION_REQUEST_STATES],
];

/** [child table, column, parent table]: every reference a mapper follows. */
export const ORPHAN_CHECKS: readonly [string, string, string][] = [
  ['judge_profile', 'user_id', 'auth_user'],
  ['judge_profile', 'current_contest_id', 'judge_contestparticipation'],
  ['judge_problem', 'group_id', 'judge_problemgroup'],
  ['judge_contestproblem', 'problem_id', 'judge_problem'],
  ['judge_contestparticipation', 'contest_id', 'judge_contest'],
  ['judge_contestparticipation', 'user_id', 'judge_profile'],
  ['judge_submission', 'user_id', 'judge_profile'],
  ['judge_submission', 'problem_id', 'judge_problem'],
  ['judge_submission', 'language_id', 'judge_language'],
  ['judge_submission', 'contest_object_id', 'judge_contest'],
  ['judge_submissionsource', 'submission_id', 'judge_submission'],
  ['judge_submissiontestcase', 'submission_id', 'judge_submission'],
  ['judge_contestsubmission', 'submission_id', 'judge_submission'],
  ['judge_contestsubmission', 'participation_id', 'judge_contestparticipation'],
  ['judge_contestsubmission', 'problem_id', 'judge_contestproblem'],
  ['judge_rating', 'participation_id', 'judge_contestparticipation'],
  ['judge_comment', 'author_id', 'judge_profile'],
  ['judge_comment', 'parent_id', 'judge_comment'],
  ['judge_ticket', 'user_id', 'judge_profile'],
  ['judge_ticketmessage', 'ticket_id', 'judge_ticket'],
];

/** Tables whose out-of-enum values are audit errors: the problem-data job cannot represent them (Task 10), so the Step 6 stop is mechanical. */
export const ENUM_ERROR_TABLES: readonly string[] = [
  'judge_problemdata',
  'judge_problemtestcase',
];

/** Password-hash algorithm names Django writes before the first `$`; anything else is never printed. */
export const KNOWN_HASH_ALGORITHMS: readonly string[] = [
  'pbkdf2_sha256',
  'pbkdf2_sha1',
  'argon2',
  'bcrypt',
  'bcrypt_sha256',
  'scrypt',
  'sha1',
  'md5',
  'unsalted_sha1',
  'unsalted_md5',
  'crypt',
];
