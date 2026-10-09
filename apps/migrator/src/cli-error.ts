/** nest-commander's default only prints a failed command's error and exits 0; a failed backfill must fail its caller. */
export function failCommand(
  error: Error,
  stderr: Pick<NodeJS.WriteStream, 'write'> = process.stderr,
) {
  stderr.write(`${error.stack ?? String(error)}\n`);
  process.exitCode = 1;
}
