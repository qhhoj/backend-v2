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
