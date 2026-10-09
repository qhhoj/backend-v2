/** `auth_user` LEFT JOIN `judge_profile` and the registration flag; profile columns are null for a user without a profile. */
export interface UserRow {
  id: number;
  password: string;
  last_login: Date | null;
  is_superuser: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_staff: number;
  is_active: number;
  date_joined: Date;
  profile_id: number | null;
  about: string | null;
  timezone: string | null;
  points: number | null;
  performance_points: number | null;
  problem_count: number | null;
  ace_theme: string | null;
  last_access: Date | null;
  ip: string | null;
  display_rank: string | null;
  mute: number | null;
  is_unlisted: number | null;
  rating: number | null;
  user_script: string | null;
  math_engine: string | null;
  is_totp_enabled: number | null;
  totp_key: Buffer | string | null;
  notes: string | null;
  current_contest_id: number | null;
  language_id: number | null;
  is_webauthn_enabled: number | null;
  data_last_downloaded: Date | null;
  scratch_codes: Buffer | string | null;
  contribution_points: number | null;
  allow_tagging: number | null;
  last_totp_timecode: number | null;
  ban_reason: string | null;
  username_display_override: string | null;
  display_badge_id: number | null;
  site_theme: string | null;
  vnoj_points: number | null;
  registration_activated: number | null;
}

export const USERS_SQL = `SELECT u.id, u.password, u.last_login, u.is_superuser, u.username, u.first_name, u.last_name, u.email,
  u.is_staff, u.is_active, u.date_joined, p.id AS profile_id, p.about, p.timezone, p.points, p.performance_points,
  p.problem_count, p.ace_theme, p.last_access, p.ip, p.display_rank, p.mute, p.is_unlisted, p.rating, p.user_script,
  p.math_engine, p.is_totp_enabled, p.totp_key, p.notes, p.current_contest_id, p.language_id, p.is_webauthn_enabled,
  p.data_last_downloaded, p.scratch_codes, p.contribution_points, p.allow_tagging, p.last_totp_timecode, p.ban_reason,
  p.username_display_override, p.display_badge_id, p.site_theme, p.vnoj_points, r.activated AS registration_activated
  FROM auth_user u LEFT JOIN judge_profile p ON p.user_id = u.id
  LEFT JOIN registration_registrationprofile r ON r.user_id = u.id ORDER BY u.id`;
