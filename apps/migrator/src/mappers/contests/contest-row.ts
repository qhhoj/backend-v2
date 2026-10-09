export interface ContestRow {
  id: number;
  key: string;
  name: string;
  description: string;
  summary: string;
  start_time: Date;
  end_time: Date;
  time_limit: number | string | null;
  is_visible: number;
  is_rated: number;
  rate_all: number;
  is_private: number;
  hide_problem_tags: number;
  run_pretests_only: number;
  og_image: string;
  logo_override_image: string;
  user_count: number;
  access_code: string;
  format_name: string;
  format_config: string | null;
  rating_ceiling: number | null;
  rating_floor: number | null;
  is_organization_private: number;
  problem_label_script: string;
  points_precision: number;
  scoreboard_visibility: string;
  virtual_count: number;
  locked_after: Date | null;
  hide_problem_authors: number;
  show_short_display: number;
  push_announcements: number;
  frozen_last_minutes: number;
  show_submission_list: number;
  scoreboard_cache_timeout: number;
  data_last_downloaded: Date | null;
  disallow_virtual: number;
  ranking_access_code: string | null;
  registration_start: Date | null;
  registration_end: Date | null;
}

export const CONTESTS_SQL = `SELECT id, \`key\`, name, description, summary, start_time, end_time, time_limit, is_visible,
  is_rated, rate_all, is_private, hide_problem_tags, run_pretests_only, og_image, logo_override_image, user_count,
  access_code, format_name, format_config, rating_ceiling, rating_floor, is_organization_private, problem_label_script,
  points_precision, scoreboard_visibility, virtual_count, locked_after, hide_problem_authors, show_short_display,
  push_announcements, frozen_last_minutes, show_submission_list, scoreboard_cache_timeout, data_last_downloaded,
  disallow_virtual, ranking_access_code, registration_start, registration_end FROM judge_contest ORDER BY id`;
