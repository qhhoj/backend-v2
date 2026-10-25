/**
 * Backend half of the backend-judge contract: the real init.yml writer, archive reader and limits write the files
 * in fixtures/, and this spec fails when they no longer match the committed copy. judge-v2 keeps the same files in
 * crates/problem/tests/fixtures/judge-contract and feeds them to its own parser, planner and extractor.
 * Refresh: UPDATE_JUDGE_CONTRACT=1 npx jest libs/problems/src/judge-contract, then copy fixtures/ to judge-v2.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { emptyProblemData } from '@libs/database';
import type { ProblemData } from '@libs/database';
import { checkerArgsProblem, graderArgsProblem } from '../checker-args';
import { compileInitYaml } from '../init-yaml';
import { judgeRefusal } from '../judge-refusals';
import { buildZip } from '../testing';
import type { ZipTestEntry } from '../testing';
import { listZipEntries, ZIP_LIMITS, ZipArchive } from '../zip-archive';
import { expectedPlan } from './expected-plan';
import type { CheckerJson } from './expected-plan';
import { INIT_YML_SCENARIOS } from './init-yml-scenarios';
import type { InitYmlScenario } from './init-yml-scenarios';

const FIXTURES = join(__dirname, 'fixtures');

/**
 * Archives on which the backend's reader (yauzl) and judge-v2's (the Rust `zip` crate) could read different
 * names or bytes, or one refuses what the other accepts. Each is written to fixtures/zips and read by both sides.
 */
interface ZipScenario {
  name: string;
  zip: Buffer;
}

const UNICODE_PATH = 0x7075;
const UNICODE_COMMENT = 0x6375;
const EXTENDED_TIMESTAMP = 0x5455;
const INFO_ZIP_UNIX = 0x7875;
const NTFS_TIMES = 0x000a;
const AES = 0x9901;
const ZIP64 = 0x0001;
const LOCAL_HEADER_BYTES = 30;

const field = (id: number, data: Buffer) => {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
};
/** An Info-ZIP Unicode Path field naming `content`, checked against `rawName`. */
const unicodePath = (
  rawName: string | Buffer,
  content: string | Buffer,
  { version = 1, crc }: { version?: number; crc?: number } = {},
) => {
  const head = Buffer.alloc(5);
  head.writeUInt8(version, 0);
  head.writeUInt32LE(crc ?? crc32(Buffer.from(rawName)), 1);
  return field(UNICODE_PATH, Buffer.concat([head, Buffer.from(content)]));
};
const bytes = (...values: number[]) => Buffer.from(values);
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const u64 = (value: number) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};
const caseFiles = (extra?: Buffer): ZipTestEntry[] => [
  { name: '1.in', content: '1\n', centralExtra: extra },
  { name: '1.out', content: '1\n' },
];
const zipOf = (entries: ZipTestEntry[]) => buildZip(entries);
/** Where `buildZip` puts entry `index`'s local header. */
const localOffsetOf = (entries: ZipTestEntry[], index: number) =>
  entries
    .slice(0, index)
    .reduce(
      (sum, entry) =>
        sum +
        LOCAL_HEADER_BYTES +
        Buffer.byteLength(entry.name) +
        Buffer.byteLength(entry.content ?? ''),
      0,
    );

function zip64Redirect(): Buffer {
  const entries: ZipTestEntry[] = [
    { name: '1.in', content: '1\n' },
    { name: '2.in', content: '2\n' },
    { name: '2.out', content: 'answer of test 2\n' },
    { name: '1.out', content: 'answer of test 1\n' },
  ];
  const size = Buffer.byteLength('answer of test 2\n');
  // Sizes that are not 0xFFFFFFFF, yet a 24-byte zip64 field holding another entry's offset.
  entries[3].centralExtra = field(
    ZIP64,
    Buffer.concat([u64(size), u64(size), u64(localOffsetOf(entries, 2))]),
  );
  return zipOf(entries);
}

/** The outer archive names 1.in = "outer"; a stored inner archive names 1.in = "inner". */
function nestedArchive(): Buffer {
  const inner = zipOf([
    { name: '1.in', content: 'inner\n' },
    { name: '1.out', content: 'inner\n' },
  ]);
  return zipOf([
    { name: '1.in', content: 'outer\n' },
    { name: '1.out', content: 'outer\n' },
    {
      name: 'notes.zip',
      content: inner,
      centralExtra: field(
        UNICODE_COMMENT,
        Buffer.concat([bytes(1), u32(0xdeadbeef), Buffer.from('c')]),
      ),
    },
  ]);
}

const CP437_HIGH = Array.from(
  { length: 128 },
  (_unused, index) => 0x80 + index,
);
const INVALID_UTF8 = [
  [0xed, 0xa0, 0x80],
  [0xf0, 0x9f],
  [0xc0, 0xaf],
  [0xff],
  [0xe2, 0x82],
];

const ZIP_SCENARIOS: ZipScenario[] = [
  // Accepted by both, with the same names and bytes.
  { name: 'control', zip: zipOf(caseFiles()) },
  {
    name: 'info_zip_style_utf8',
    zip: zipOf([
      { name: 'đề bài/' },
      {
        name: 'đề bài/1.inp',
        content: '1\n',
        centralExtra: Buffer.concat([
          field(EXTENDED_TIMESTAMP, Buffer.concat([bytes(3), u32(1)])),
          field(INFO_ZIP_UNIX, Buffer.alloc(0)),
        ]),
      },
      { name: 'đề bài/1.out', content: '1\n' },
    ]),
  },
  {
    name: 'cp437_high_bytes',
    zip: zipOf(
      CP437_HIGH.map((byte) => ({
        name: `h${byte}`,
        rawName: Buffer.concat([
          Buffer.from('h'),
          bytes(byte),
          Buffer.from('.in'),
        ]),
        content: '1\n',
      })),
    ),
  },
  {
    name: 'utf8_flag_invalid_bytes',
    zip: zipOf(
      INVALID_UTF8.map((sequence, index) => ({
        name: `u${index}`,
        rawName: Buffer.concat([
          Buffer.from(`u${index}`),
          bytes(...sequence),
          Buffer.from('.in'),
        ]),
        utf8: true,
        content: '1\n',
      })),
    ),
  },
  { name: 'zip64_end_record', zip: buildZip(caseFiles(), { zip64: true }) },
  {
    name: 'unicode_path_valid',
    zip: zipOf([
      {
        name: 'cp437',
        rawName: Buffer.from('de 1.in'),
        content: '1\n',
        centralExtra: unicodePath('de 1.in', 'đề 1.in'),
      },
      { name: 'đề 1.out', content: '1\n' },
    ]),
  },
  // Refused by both.
  {
    name: 'unicode_path_bad_crc',
    zip: zipOf(caseFiles(unicodePath('1.in', '1.in', { crc: 0xdeadbeef }))),
  },
  {
    name: 'unicode_path_version_2',
    zip: zipOf([
      { name: '1.in', content: '1\n' },
      { name: '2.in', content: '2\n' },
      {
        name: '1.out',
        content: 'answer of test 2\n',
        centralExtra: unicodePath('1.out', '2.out', { version: 2 }),
      },
      {
        name: '2.out',
        content: 'answer of test 1\n',
        centralExtra: unicodePath('2.out', '1.out', { version: 2 }),
      },
    ]),
  },
  {
    name: 'unicode_path_two_fields',
    zip: zipOf(
      caseFiles(
        Buffer.concat([
          unicodePath('1.in', '1.in'),
          unicodePath('1.in', '9.in'),
        ]),
      ),
    ),
  },
  {
    name: 'unicode_path_empty',
    zip: zipOf(caseFiles(unicodePath('1.in', ''))),
  },
  {
    name: 'unicode_path_invalid_utf8',
    zip: zipOf(
      caseFiles(unicodePath('1.in', bytes(0x31, 0xff, 0x2e, 0x69, 0x6e))),
    ),
  },
  {
    name: 'cp437_control_bytes',
    zip: zipOf([
      { name: 'a', rawName: Buffer.from('a\u0001b.in'), content: '1\n' },
      { name: 'c', rawName: Buffer.from('c\u007fd.out'), content: '1\n' },
    ]),
  },
  {
    name: 'extended_timestamp_length_mismatch',
    zip: zipOf(
      caseFiles(
        field(EXTENDED_TIMESTAMP, Buffer.concat([bytes(7), Buffer.alloc(8)])),
      ),
    ),
  },
  {
    name: 'extended_timestamp_unknown_flag',
    zip: zipOf(
      caseFiles(field(EXTENDED_TIMESTAMP, Buffer.concat([bytes(9), u32(0)]))),
    ),
  },
  {
    name: 'ntfs_times_bad_length',
    zip: zipOf(caseFiles(field(NTFS_TIMES, Buffer.alloc(4)))),
  },
  {
    name: 'aes_field_unencrypted',
    zip: zipOf(caseFiles(field(AES, Buffer.from([2, 0, 0x41, 0x45, 3, 8, 0])))),
  },
  { name: 'zip64_field_redirect', zip: zip64Redirect() },
  { name: 'nested_archive', zip: nestedArchive() },
  {
    name: 'end_record_counts_disagree',
    zip: buildZip(caseFiles(), { diskEntryCount: 1 }),
  },
  {
    name: 'zip64_end_records_disagree',
    zip: buildZip(caseFiles(), { zip64: true, zip32EntryCount: 1 }),
  },
  {
    name: 'file_and_directory_same_name',
    zip: zipOf([
      { name: 'a', content: 'x\n' },
      { name: 'a/1.in', content: '1\n' },
      { name: 'a/1.out', content: '1\n' },
    ]),
  },
  {
    name: 'long_segment_vietnamese',
    zip: zipOf([
      ...caseFiles(),
      { name: `đề bài ${'ệ'.repeat(90)}.pdf`, content: 'n\n' },
    ]),
  },
  {
    name: 'long_path',
    zip: zipOf([
      ...caseFiles(),
      {
        name: `${Array.from({ length: 17 }, () => 'd'.repeat(250)).join('/')}/x`,
        content: 'n\n',
      },
    ]),
  },
  {
    name: 'symlink_directory',
    zip: zipOf([...caseFiles(), { name: 'link/', symlink: true }]),
  },
];

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Why the backend refuses to save the data, or null: the same checks the data form runs. */
function refusalOf(data: ProblemData): string | null {
  const checker = checkerArgsProblem(data.checker, data.checkerArgs);
  if (checker) return `checkerArgs: ${checker}`;
  const grader = graderArgsProblem(data.grader, data.graderArgs);
  if (grader) return `graderArgs: ${grader}`;
  for (const [index, row] of data.cases.entries()) {
    const problem = row.checker
      ? checkerArgsProblem(row.checker, row.checkerArgs)
      : null;
    if (problem) return `cases.${index}: ${problem}`;
  }
  const refusal = judgeRefusal(data);
  return refusal ? `${refusal.field}: ${refusal.message}` : null;
}

/** The problem checker the written init.yml names. */
function problemCheckerOf(yaml: string): CheckerJson {
  const { checker } = parse(yaml) as {
    checker: string | { name: string; args?: CheckerJson['args'] };
  };
  return typeof checker === 'string'
    ? { name: checker, args: {} }
    : { name: checker.name, args: checker.args ?? {} };
}

function writeInitYml(out: string, scenario: InitYmlScenario): void {
  const data: ProblemData = {
    ...emptyProblemData(),
    archive: 'tests.zip',
    ...scenario.data,
  };
  const entries = new Set(
    data.cases.flatMap((row) => [row.input, row.output]).filter(Boolean),
  );
  const refused = refusalOf(data);
  let feedback: string | null = null;
  let compiled: ReturnType<typeof compileInitYaml> | null = null;
  try {
    compiled = compileInitYaml(data, entries);
  } catch (error) {
    feedback = (error as Error).message;
  }
  const expectation: Record<string, unknown> = {
    accepted: refused === null && feedback === null && !!compiled?.yaml,
    refused,
    feedback,
  };
  if (compiled?.yaml) {
    writeFileSync(join(out, `${scenario.name}.yml`), compiled.yaml);
    const problem = {
      checker: problemCheckerOf(compiled.yaml),
      outputLimit: data.outputLimit,
      outputPrefix: data.outputPrefix,
    };
    expectation.full = expectedPlan(compiled.cases, problem, false);
    expectation.pretest = expectedPlan(compiled.cases, problem, true);
  }
  writeFileSync(join(out, `${scenario.name}.expect.json`), json(expectation));
}

/** What the upload accepts (`listZipEntries`), and each name a case may use with its bytes. */
async function verdictOf(path: string): Promise<Record<string, unknown>> {
  try {
    const names = await listZipEntries(path);
    const zip = await ZipArchive.open(path);
    const files: Record<string, string> = {};
    for (const name of names)
      files[name] = (await zip.read(name)).toString('utf8');
    await zip.close();
    return { accepted: true, files };
  } catch (error) {
    return { accepted: false, error: (error as Error).message };
  }
}

async function writeZips(out: string): Promise<void> {
  const verdicts: Record<string, unknown> = {};
  for (const { name, zip } of ZIP_SCENARIOS) {
    const path = join(out, `${name}.zip`);
    writeFileSync(path, zip);
    verdicts[name] = await verdictOf(path);
  }
  writeFileSync(join(out, 'backend.json'), json(verdicts));
}

async function generate(): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), 'qhhoj-judge-contract-'));
  mkdirSync(join(out, 'init-yml'));
  mkdirSync(join(out, 'zips'));
  for (const scenario of INIT_YML_SCENARIOS)
    writeInitYml(join(out, 'init-yml'), scenario);
  await writeZips(join(out, 'zips'));
  writeFileSync(
    join(out, 'limits.json'),
    json({
      maxEntries: ZIP_LIMITS.maxEntries,
      maxTotalBytes: ZIP_LIMITS.maxTotalBytes,
    }),
  );
  return out;
}

const filesUnder = (root: string): Map<string, Buffer> =>
  new Map(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [relative(root, path), readFileSync(path)] as const;
      }),
  );

describe('backend-judge contract fixtures', () => {
  let generated: string;
  beforeAll(async () => {
    generated = await generate();
    if (process.env.UPDATE_JUDGE_CONTRACT) {
      rmSync(FIXTURES, { recursive: true, force: true });
      cpSync(generated, FIXTURES, { recursive: true });
    }
  });
  afterAll(() => rmSync(generated, { recursive: true, force: true }));

  it('match what the writer, the archive reader and the limits produce now', () => {
    const want = filesUnder(generated);
    const have = filesUnder(FIXTURES);
    expect([...have.keys()].sort()).toEqual([...want.keys()].sort());
    const stale = [...want].filter(
      ([path, content]) => !have.get(path)?.equals(content),
    );
    expect(stale.map(([path]) => path)).toEqual([]);
  });
});
