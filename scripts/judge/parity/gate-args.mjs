import { chmodSync, writeFileSync } from 'node:fs';

/** `--name value` pairs of a command line; anything else is an error. */
export function parseArguments(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      throw new Error(`bad argument ${argv[i]}`);
    }
    values[argv[i].slice(2)] = argv[i + 1];
  }
  return values;
}

/** The file may hold source: `mode` applies only on creation, so tighten an existing file too. */
export function writePrivate(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}
