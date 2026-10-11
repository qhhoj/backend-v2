export class AuditActorResponse {
  /** User id. */
  id!: string;
  /** Username; null when the account no longer exists. */
  username!: string | null;
}

export class AuditObjectResponse {
  /** Object id, or the key for a setting. */
  id!: string;
  /** What to call the object: problem code, contest key, username, organization slug, page url, post title, setting key, catalog name. Null when the kind has no name (comment, submission) or the object is gone. */
  label!: string | null;
  /** The object no longer exists (or is soft-deleted); clients show the label without a link. */
  deleted!: boolean;
}

export class AuditEntryResponse {
  /** Record id (UUIDv7, sorts by time). */
  id!: string;
  /** When the change was made. */
  at!: Date;
  /** Who made it; null for system writes (workers, imports). */
  actor!: AuditActorResponse | null;
  /** Object kind: a `revisions` entity such as `problem`, or `setting`. */
  type!: string;
  /** What was done: `create`, `edit`, `delete`, `hide`, `lock`, ... as the writer recorded it. */
  action!: string;
  /** The object changed. */
  object!: AuditObjectResponse;
  /** Names of the changed fields. Values are never returned: some records hold sensitive before/after values. */
  changedFields!: string[];
  /** The writer's free-text note, often empty. */
  comment!: string;
}

export class AuditFeedResponse {
  /** Newest first, at most `limit`. */
  items!: AuditEntryResponse[];
  /** Pass as `before` to read the next (older) page; null on the last page. */
  nextBefore!: string | null;
}
