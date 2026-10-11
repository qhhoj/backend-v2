import type { Permission } from './permissions';

export const PERMISSION_CATEGORIES = [
  'problems',
  'contests',
  'submissions',
  'organizations',
  'users',
  'community',
  'site',
  'judging',
] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/** Every known codename with its category and an English label; typed on `Permission`, so a new codename does not compile without one. */
export const PERMISSION_CATALOG: Record<
  Permission,
  { category: PermissionCategory; label: string }
> = {
  'judge.see_private_problem': {
    category: 'problems',
    label: 'See private problems',
  },
  'judge.add_problem': { category: 'problems', label: 'Create problems' },
  'judge.edit_own_problem': {
    category: 'problems',
    label: 'Edit own problems',
  },
  'judge.create_organization_problem': {
    category: 'problems',
    label: 'Create organization problems',
  },
  'judge.edit_all_problem': {
    category: 'problems',
    label: 'Edit every problem',
  },
  'judge.edit_public_problem': {
    category: 'problems',
    label: 'Edit public problems',
  },
  'judge.suggest_new_problem': {
    category: 'problems',
    label: 'Suggest new problems',
  },
  'judge.problem_full_markup': {
    category: 'problems',
    label: 'Use unsanitised problem markup',
  },
  'judge.clone_problem': { category: 'problems', label: 'Clone problems' },
  'judge.upload_file_statement': {
    category: 'problems',
    label: 'Upload statement files',
  },
  'judge.upload_problem_material': {
    category: 'problems',
    label: 'Upload problem materials',
  },
  'judge.change_public_visibility': {
    category: 'problems',
    label: 'Make problems public or private',
  },
  'judge.change_manually_managed': {
    category: 'problems',
    label: 'Mark problem data as manually managed',
  },
  'judge.see_organization_problem': {
    category: 'problems',
    label: 'See organization problems',
  },
  'judge.import_polygon_package': {
    category: 'problems',
    label: 'Import Polygon packages',
  },
  'judge.delete_problem': { category: 'problems', label: 'Delete problems' },
  'judge.add_tagproblem': { category: 'problems', label: 'Tag problems' },
  'judge.see_private_solution': {
    category: 'problems',
    label: 'See private editorials',
  },
  'judge.high_problem_timelimit': {
    category: 'problems',
    label: 'Set high time limits',
  },
  'judge.add_problemtype': {
    category: 'problems',
    label: 'Create problem types',
  },
  'judge.change_problemtype': {
    category: 'problems',
    label: 'Edit problem types',
  },
  'judge.add_problemgroup': {
    category: 'problems',
    label: 'Create problem groups',
  },
  'judge.change_problemgroup': {
    category: 'problems',
    label: 'Edit problem groups',
  },
  'judge.add_license': { category: 'problems', label: 'Create licenses' },
  'judge.change_license': { category: 'problems', label: 'Edit licenses' },
  'judge.create_mass_testcases': {
    category: 'problems',
    label: 'Create many test cases',
  },
  'judge.add_contest': { category: 'contests', label: 'Create contests' },
  'judge.see_private_contest': {
    category: 'contests',
    label: 'See private contests',
  },
  'judge.edit_own_contest': {
    category: 'contests',
    label: 'Edit own contests',
  },
  'judge.edit_all_contest': {
    category: 'contests',
    label: 'Edit every contest',
  },
  'judge.clone_contest': { category: 'contests', label: 'Clone contests' },
  'judge.moss_contest': {
    category: 'contests',
    label: 'Run code similarity checks',
  },
  'judge.contest_rating': { category: 'contests', label: 'Rate contests' },
  'judge.contest_access_code': {
    category: 'contests',
    label: 'Set contest access codes',
  },
  'judge.create_private_contest': {
    category: 'contests',
    label: 'Create private contests',
  },
  'judge.change_contest_visibility': {
    category: 'contests',
    label: 'Show or hide contests',
  },
  'judge.contest_problem_label': {
    category: 'contests',
    label: 'Set contest problem labels',
  },
  'judge.lock_contest': { category: 'contests', label: 'Lock contests' },
  'judge.change_contest_tag': {
    category: 'contests',
    label: 'Edit contest tags',
  },
  'judge.long_contest_duration': {
    category: 'contests',
    label: 'Create long contests',
  },
  'judge.abort_any_submission': {
    category: 'submissions',
    label: 'Abort any submission',
  },
  'judge.rejudge_submission': {
    category: 'submissions',
    label: 'Rejudge submissions',
  },
  'judge.reject_submission': {
    category: 'submissions',
    label: 'Reject submissions',
  },
  'judge.rejudge_submission_lot': {
    category: 'submissions',
    label: 'Rejudge many submissions',
  },
  'judge.spam_submission': {
    category: 'submissions',
    label: 'Submit without rate limits',
  },
  'judge.view_all_submission': {
    category: 'submissions',
    label: 'See every submission',
  },
  'judge.resubmit_other': {
    category: 'submissions',
    label: "Resubmit others' code",
  },
  'judge.lock_submission': {
    category: 'submissions',
    label: 'Lock submissions',
  },
  'judge.organization_admin': {
    category: 'organizations',
    label: 'Administer organizations',
  },
  'judge.edit_all_organization': {
    category: 'organizations',
    label: 'Edit every organization',
  },
  'judge.change_open_organization': {
    category: 'organizations',
    label: 'Open or close organizations',
  },
  'judge.spam_organization': {
    category: 'organizations',
    label: 'Exceed the organization admin cap',
  },
  'judge.add_organization': {
    category: 'organizations',
    label: 'Create organizations',
  },
  'judge.ban_user': { category: 'users', label: 'Ban users and list accounts' },
  'judge.can_see_user_activity': {
    category: 'users',
    label: 'See user activity',
  },
  'judge.change_profile': { category: 'users', label: 'Edit user profiles' },
  'auth.change_user': {
    category: 'users',
    label: 'Change e-mails, passwords and account status',
  },
  'auth.add_user': { category: 'users', label: 'Create user accounts' },
  'judge.totp': { category: 'users', label: 'Manage two-factor settings' },
  'judge.can_upload_image': { category: 'community', label: 'Upload images' },
  'judge.view_all_user_comment': {
    category: 'community',
    label: 'See every comment',
  },
  'judge.override_comment_lock': {
    category: 'community',
    label: 'Comment on locked pages',
  },
  'judge.change_comment': { category: 'community', label: 'Moderate comments' },
  'judge.edit_all_post': {
    category: 'community',
    label: 'Edit every blog post',
  },
  'judge.edit_organization_post': {
    category: 'community',
    label: 'Edit organization posts',
  },
  'judge.mark_global_post': {
    category: 'community',
    label: 'Show posts site-wide',
  },
  'judge.pin_post': { category: 'community', label: 'Pin posts' },
  'judge.change_blogpost': {
    category: 'community',
    label: 'Change blog posts',
  },
  'judge.delete_blogpost': {
    category: 'community',
    label: 'Delete blog posts',
  },
  'judge.change_ticket': { category: 'community', label: 'Handle tickets' },
  'judge.change_settings': {
    category: 'site',
    label: 'Change site settings (operators only)',
  },
  'judge.change_miscconfig': {
    category: 'site',
    label: 'Edit announcements and site snippets',
  },
  'judge.change_navigationbar': {
    category: 'site',
    label: 'Navigation bar (retired)',
  },
  'flatpages.add_flatpage': { category: 'site', label: 'Create pages' },
  'flatpages.change_flatpage': { category: 'site', label: 'Edit pages' },
  'flatpages.delete_flatpage': { category: 'site', label: 'Delete pages' },
  'judge.manage_short_link': { category: 'site', label: 'Manage short links' },
  'judge.manage_integration': {
    category: 'site',
    label: 'Manage integration clients',
  },
  'judge.test_site': { category: 'site', label: 'Use test features' },
  'judge.change_judge': { category: 'judging', label: 'Manage judges' },
  'judge.add_language': { category: 'judging', label: 'Add languages' },
  'judge.change_language': { category: 'judging', label: 'Edit languages' },
};

export const isKnownPermission = (codename: string): codename is Permission =>
  Object.hasOwn(PERMISSION_CATALOG, codename);
