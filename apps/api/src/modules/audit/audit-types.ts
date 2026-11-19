import { REVISION_ENTITIES } from '@libs/database';

/** The object kinds whose writes leave a record: every `revisions` kind, plus `setting` (the `settingRevisions` collection). */
export const AUDIT_TYPES = [...REVISION_ENTITIES, 'setting'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

/** Settings keep their own history collection; every other kind is a `revisions` row. */
export const SETTING_TYPE: AuditType = 'setting';

export const AUDIT_PAGE_SIZE = 50;
