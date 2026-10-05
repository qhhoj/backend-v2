import { spawnSync } from 'node:child_process';
import { emitYaml } from './yaml-emit';

const pythonLoad = (text: string) =>
  spawnSync(
    'python3',
    [
      '-c',
      'import sys,yaml,json; print(json.dumps(yaml.safe_load(sys.stdin.read())))',
    ],
    { input: text, encoding: 'utf8' },
  );
/** CI must fail, not skip, when the oracle is missing. */
const hasPyYaml = Boolean(process.env.CI) || pythonLoad('a: 1').status === 0;

const HOSTILE_STRINGS = [
  'yes',
  'No',
  'ON',
  'off',
  'true',
  'False',
  'null',
  'Null',
  '~',
  '',
  ' ',
  'y',
  'n',
  '1_000',
  '0b101',
  '0o17',
  '017',
  '0x1F',
  '1:30',
  '1:30:00',
  '190:20:30',
  '2024-01-01',
  '2024-01-01 10:00:00',
  '2024-01-01T10:00:00Z',
  '1.5',
  '1e3',
  '1.0e+3',
  '.5',
  '.inf',
  '-.inf',
  '.nan',
  '=',
  '<<',
  'a\tb',
  '\ta',
  'a\u0085b',
  'a\u2028b',
  'a\u2029b',
  'a\u007fb',
  '\ufeffa',
  'a\r\nb',
  'a: b',
  'a #b',
  '- a',
  '? a',
  '& a',
  '* a',
  '! a',
  '| a',
  '> a',
  '@a',
  '`a',
  '%a',
  '{a}',
  '[a]',
  'a,b',
  '"quoted"',
  "it's",
  'back\\slash',
  'ünïcode',
  '日本語',
  '😀',
  '1.in',
  '01.out',
  'tests.zip',
  '1 2',
  '-5',
  '+5',
];
const hostileDocument = {
  strings: HOSTILE_STRINGS,
  byKey: Object.fromEntries(HOSTILE_STRINGS.map((text) => [text, text])),
  numbers: [0, -1, 42, 2 ** 53 - 1, 1.5, -0.25, 1e21, 1e-7, 123456789.125],
  mixed: [
    true,
    false,
    null,
    [],
    {},
    [[1], [2, [3]]],
    { a: [{ b: { c: [] } }] },
  ],
};

(hasPyYaml ? describe : describe.skip)(
  'emitYaml against PyYAML safe_load',
  () => {
    it('round-trips a hostile matrix of strings, keys, numbers and nesting', () => {
      const { status, stdout, stderr } = pythonLoad(emitYaml(hostileDocument));
      expect(stderr).toBe('');
      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toEqual(
        JSON.parse(JSON.stringify(hostileDocument)),
      );
    });
  },
);
