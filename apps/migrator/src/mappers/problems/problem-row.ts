export interface ProblemRow {
  id: number;
  code: string;
  name: string;
  description: string;
  time_limit: number;
  memory_limit: number;
  points: number;
  partial: number;
  is_public: number;
  is_manually_managed: number;
  date: Date | null;
  og_image: string;
  summary: string;
  user_count: number;
  ac_rate: number;
  is_organization_private: number;
  group_id: number;
  license_id: number | null;
  is_full_markup: number;
  pdf_url: string;
  source: string;
  suggester_id: number | null;
  submission_source_visibility_mode: string;
  testcase_visibility_mode: string;
  allow_view_feedback: number;
  testcase_result_visibility_mode: string;
  problem_material: string | null;
  mirror_of_id: number | null;
  mirror_root_id: number | null;
}

export const PROBLEMS_SQL = `SELECT id, code, name, description, time_limit, memory_limit, points, partial, is_public,
  is_manually_managed, date, og_image, summary, user_count, ac_rate, is_organization_private, group_id, license_id,
  is_full_markup, pdf_url, source, suggester_id, submission_source_visibility_mode, testcase_visibility_mode,
  allow_view_feedback, testcase_result_visibility_mode, problem_material, mirror_of_id, mirror_root_id
  FROM judge_problem ORDER BY id`;
