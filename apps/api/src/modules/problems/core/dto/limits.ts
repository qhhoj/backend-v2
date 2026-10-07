import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';

export { MAX_MARKDOWN_LENGTH } from '@libs/problems';
/** Legacy VNOJ_TESTCASE_HARD_LIMIT; `judge.create_mass_testcases` lifts it to the legacy editor's 9999. */
export const MAX_TESTCASES = 300;
export const MAX_TESTCASES_MASS = 9999;
/** Legacy VNOJ_TESTCASE_SOFT_LIMIT: a warning threshold for the editor UI, never enforced. */
export const SOFT_TESTCASES = 50;
/** Fastify's default 1 MiB is too small for 9999 cases (1.6-3.8 MB of JSON); only the data PUT route is raised. */
export const DATA_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
/** Total size of all per-case generator and checker arguments in one request. */
export const MAX_CASE_ARGS_BYTES = 1024 * 1024;
export const maxTestcasesFor = (principal: Principal): number =>
  hasPermission(principal, 'judge.create_mass_testcases')
    ? MAX_TESTCASES_MASS
    : MAX_TESTCASES;
