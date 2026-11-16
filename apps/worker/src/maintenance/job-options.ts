export interface JobOptions {
  apply: boolean;
  /** Where `--apply` writes the old columns of every row it changes; required with `--apply`. */
  backup: string | null;
  includeImgur: boolean;
}

/** `--dry-run` (default) | `--apply --backup <file>`, plus `--include-imgur` for the image job. Anything else is an error, so a typo never turns into a write. */
export function parseJobOptions(args: readonly string[]): JobOptions {
  const options: JobOptions = {
    apply: false,
    backup: null,
    includeImgur: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--include-imgur') options.includeImgur = true;
    else if (arg === '--backup') options.backup = args[++index] ?? '';
    else if (arg.startsWith('--backup=')) options.backup = arg.slice(9);
    else throw new Error(`unknown option: ${arg}`);
  }
  if (args.includes('--dry-run') && options.apply)
    throw new Error('--dry-run and --apply exclude each other');
  if (options.apply && !options.backup)
    throw new Error('--apply needs --backup <file>');
  return options;
}
