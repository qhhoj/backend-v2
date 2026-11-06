/** A one-off data fix run by `worker migrate` (the deploy's migrate step, before the restart) while the previous release still serves. */
export interface Migration {
  /** Recorded in the `migrations` collection once `run` resolves, and never run again; never rename or reuse one. */
  readonly id: string;
  /** Idempotent, and writes with compare-and-set against what it read (the live release writes meanwhile): a second run changes nothing. Returns how many rows it fixed, for the log. */
  run(): Promise<number>;
}

export const MIGRATIONS = Symbol('MIGRATIONS');
