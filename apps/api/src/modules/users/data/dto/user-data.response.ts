export class UserDataStatusResponse {
  state!: 'none' | 'preparing' | 'ready';
  /** When the last prepare was requested. */
  preparedAt!: string | null;
  /** When the zip on disk was written. */
  readyAt!: string | null;
  /** When the zip stops being downloadable. */
  expiresAt!: string | null;
  size!: number | null;
  /** Null when a prepare is allowed now. */
  nextPrepareAt!: string | null;
  /** A prepare would be accepted now: no job running, the once-a-day rule met and the three-a-day limit not used up. */
  canPrepare!: boolean;
}
