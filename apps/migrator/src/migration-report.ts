const SHOWN_LINES = 10;

/** What a job imported differently from legacy or left out. Lines name a legacy `table:id`, a code or a key, never row content. */
export class MigrationReport {
  private readonly counts = new Map<string, number>();

  add(message: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  lines(): string[] {
    return [...this.counts].map(([message, count]) =>
      count > 1 ? `${message} (x${count})` : message,
    );
  }

  flush(job: string, logger: { warn(message: string): void }): void {
    const lines = this.lines();
    for (const line of lines.slice(0, SHOWN_LINES))
      logger.warn(`${job}: ${line}`);
    if (lines.length > SHOWN_LINES)
      logger.warn(
        `${job}: ${lines.length - SHOWN_LINES} more distinct report line(s) (all are in the report file)`,
      );
  }
}
