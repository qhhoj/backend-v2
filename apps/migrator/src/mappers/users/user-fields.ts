import { MapCtx } from '../../mapper';
import { UserRow } from './user-row';

/** D4: shown at login and in the staff banned list; keeps the account out of the stale-pending reclaim. */
export const LEGACY_DEACTIVATED_REASON = 'Account deactivated on the old site.';

/** D4: inactive, no ban reason and not a pending signup (activation not done and never logged in: a login means it was used, then deactivated). Pending signups stay reclaimable. */
export function isLegacyDeactivated(row: UserRow): boolean {
  const pending = row.registration_activated === 0 && row.last_login == null;
  return !row.ban_reason && !Number(row.is_active) && !pending;
}

export function banReasonOf(row: UserRow): string | null {
  if (row.ban_reason) return row.ban_reason;
  return isLegacyDeactivated(row) ? LEGACY_DEACTIVATED_REASON : null;
}

/** User ruling: a deactivated account migrates with the v2 ban shape (`UserModerationService.ban`); applied after the profile fields. */
export function deactivatedBanFields(row: UserRow) {
  return isLegacyDeactivated(row)
    ? { displayRank: 'banned', isUnlisted: true, isActive: false }
    : {};
}

export function accountFields(row: UserRow, ctx: MapCtx) {
  return {
    username: row.username,
    email: row.email ?? '',
    password: row.password,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    isStaff: ctx.bool(row.is_staff),
    isActive: ctx.bool(row.is_active),
    isSuperuser: ctx.bool(row.is_superuser),
    lastLogin: ctx.date(row.last_login),
    dateJoined: ctx.date(row.date_joined),
    banReason: banReasonOf(row),
    apiTokenHash: null,
    createdAt: ctx.date(row.date_joined),
    updatedAt: ctx.date(row.date_joined),
  };
}

export function profileTextFields(row: UserRow, ctx: MapCtx) {
  return {
    about: row.about,
    aboutHtml: ctx.render(row.about, 'user', `judge_profile:${row.profile_id}`),
    timezone: row.timezone ?? 'America/Toronto',
    aceTheme: row.ace_theme ?? 'auto',
    siteTheme: row.site_theme ?? 'auto',
    mathEngine: row.math_engine ?? 'auto',
    appearance: null,
    displayRank: row.display_rank ?? 'user',
    userScript: row.user_script ?? '',
    notes: row.notes,
    usernameDisplayOverride: row.username_display_override ?? '',
    ip: row.ip,
    lastAccess: ctx.date(row.last_access),
    dataLastDownloaded: ctx.date(row.data_last_downloaded),
  };
}

export function profileStateFields(row: UserRow, ctx: MapCtx) {
  return {
    languageId: ctx.refOrNull('judge_language', row.language_id),
    currentParticipation: ctx.refOrNull(
      'judge_contestparticipation',
      row.current_contest_id,
    ),
    points: row.points ?? 0,
    performancePoints: row.performance_points ?? 0,
    problemCount: row.problem_count ?? 0,
    contributionPoints: row.contribution_points ?? 0,
    vnojPoints: row.vnoj_points ?? 0,
    rating: null,
    mute: ctx.bool(row.mute),
    isUnlisted: ctx.bool(row.is_unlisted),
    allowTagging:
      row.allow_tagging == null ? true : ctx.bool(row.allow_tagging),
    badges: [],
    displayBadgeId: null,
  };
}
