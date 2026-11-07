export type EnvSource = Record<string, string | undefined>;

/** Typed reads from `source` that collect every problem instead of throwing, so one boot reports them all. */
export class EnvReader {
  readonly problems: string[] = [];

  constructor(private readonly source: EnvSource) {}

  /** The raw value, `fallback` only when unset (a blank stays blank). */
  text(name: string, fallback = ''): string {
    return this.source[name] ?? fallback;
  }

  /** Blank counts as unset. */
  nonBlankOr<Fallback>(name: string, fallback: Fallback): string | Fallback {
    return this.source[name] || fallback;
  }

  required(name: string): string {
    return this.source[name] || (this.problem(`${name} is required`), '');
  }

  booleanFrom(name: string, fallback: boolean): boolean {
    const value = this.source[name];
    if (value === undefined) return fallback;
    if (value !== 'true' && value !== 'false')
      this.problem(`${name} must be true or false`);
    return value === 'true';
  }

  /** Blank counts as unset. */
  integer(name: string, fallback: number, min: number, max?: number): number {
    const raw = this.source[name]?.trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < min || value > (max ?? Infinity))
      this.problem(
        `${name} must be ${max === undefined ? `an integer of at least ${min}` : `${min}-${max}`}`,
      );
    return value;
  }

  problem(message: string): void {
    this.problems.push(message);
  }
}
