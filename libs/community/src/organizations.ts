/** Legacy `VNOJ_ORG_PP_STEP` and `VNOJ_ORG_PP_ENTRIES` (`VNOJ_ORG_PP_SCALE` is 1). */
export const ORGANIZATION_PP_STEP = 0.95;
export const ORGANIZATION_PP_ENTRIES = 100;
/** Legacy `DMOJ_USER_MAX_ORGANIZATION_COUNT`: open organizations a user may join; private ones are uncapped. */
export const MAX_OPEN_ORGANIZATIONS = 3;
/** Legacy `VNOJ_ORGANIZATION_ADMIN_LIMIT`: admin roles per user unless the acting user has `judge.spam_organization`. */
export const ORGANIZATION_ADMIN_LIMIT = 3;
/** Legacy `GROUP_PERMISSION_FOR_ORG_ADMIN`: the group new admins join when it exists. */
export const ORGANIZATION_ADMIN_GROUP = 'Org Admin';
/** Legacy `short_name = slug[:20]`, shown beside users in contests. */
export const SHORT_NAME_LENGTH = 20;

/** Legacy `Organization.calculate_points`: members' performance points above 0, best first, the top 100 weighed by 0.95^rank. */
export function organizationPoints(memberPoints: readonly number[]): number {
  return memberPoints
    .filter((points) => points > 0)
    .sort((left, right) => right - left)
    .slice(0, ORGANIZATION_PP_ENTRIES)
    .reduce(
      (sum, points, rank) => sum + ORGANIZATION_PP_STEP ** rank * points,
      0,
    );
}
