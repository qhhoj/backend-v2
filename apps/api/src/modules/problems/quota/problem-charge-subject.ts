import { uuidStr } from '@libs/database';
import type { ChargeSubject } from '../../organizations/quota/quota-charge';
import type { ProblemDocument } from '../core/problems.repository';

/** Hydrated documents hold UUID arrays as buffers; the quota wants strings. */
export const problemChargeSubject = (
  problem: Pick<ProblemDocument, 'isOrganizationPrivate' | 'organizations'>,
): Required<ChargeSubject> => ({
  isOrganizationPrivate: problem.isOrganizationPrivate,
  organizations: problem.organizations.map(uuidStr),
});
