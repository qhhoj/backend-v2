/**
 * The object kinds whose writes leave a record: every `revisions.entity` the API and worker write, plus `setting`
 * (the `settingRevisions` collection). A kind added to `revisions` later still shows in the unfiltered feed;
 * add it here to make it filterable and labelled.
 */
export const AUDIT_TYPES = [
  'problem',
  'tagProblem',
  'problemType',
  'problemGroup',
  'license',
  'contest',
  'contestParticipation',
  'submission',
  'submission_batch',
  'user',
  'group',
  'organization',
  'blogPost',
  'comment',
  'flatpage',
  'setting',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

/** Settings keep their own history collection; every other kind is a `revisions` row. */
export const SETTING_TYPE: AuditType = 'setting';

export const AUDIT_PAGE_SIZE = 50;
