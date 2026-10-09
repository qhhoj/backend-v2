// The 20 parity problems and their 55 runs (judge-v2 cutover Task 5; scripts/judge/parity/README.md).
import { EMPTY_TEST_CASE } from '@libs/database';
import type { ProblemData, ProblemTestCase } from '@libs/database';

/** The live contest of `par_pre_contest`: `runPretestsOnly`, so its Assign carries `pretests_only = true`. */
export const PARITY_CONTEST = 'par_contest';

export interface ParityProblemRun {
  language: 'PY3' | 'CPP17' | 'TEXT' | 'OUTPUT';
  name: string;
  /** Empty for OUTPUT runs, which send `file` as a zip. */
  source: string;
  file?: Record<string, string>;
}

export interface ParityProblem {
  code: string;
  data: Partial<ProblemData>;
  caseFiles: Record<string, string>;
  dataFiles?: Record<string, string>;
  archive?: string;
  partial?: boolean;
  /** Submitted from inside this contest (seeded with the problem pretested). */
  contest?: string;
  runs: ParityProblemRun[];
}

const plain = (
  position: number,
  points: number | null,
  extra: Partial<ProblemTestCase> = {},
): ProblemTestCase => ({
  ...EMPTY_TEST_CASE,
  type: 'C',
  input: `${position}.in`,
  output: `${position}.out`,
  points,
  ...extra,
});
const start = (points: number, isPretest = false): ProblemTestCase => ({
  ...EMPTY_TEST_CASE,
  type: 'S',
  points,
  isPretest,
});
const end = (): ProblemTestCase => ({ ...EMPTY_TEST_CASE, type: 'E' });
const sums = (pairs: [number, number][]) =>
  Object.fromEntries(
    pairs.flatMap(([left, right], index) => [
      [`${index + 1}.in`, `${left} ${right}\n`],
      [`${index + 1}.out`, `${left + right}\n`],
    ]),
  );

const PY_SUM = 'a, b = map(int, input().split())\nprint(a + b)\n';
const PY_SUM_UNLESS = (bad: string) =>
  `a, b = map(int, input().split())\nprint(0 if (a, b) == ${bad} else a + b)\n`;
const CPP_SUM =
  '#include <cstdio>\nint main(){long long a,b;std::scanf("%lld %lld",&a,&b);std::printf("%lld\\n",a+b);}\n';

/** The checker of plan B Task 19: AC on the answer, half points on answer + 1, WA otherwise. */
const TESTLIB_CHECKER = `#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    int want = ans.readInt(), got = ouf.readInt();
    if (got == want) quitf(_ok, "correct");
    if (got == want + 1) quitp(0.5, "close");
    quitf(_wa, "expected %d, found %d", want, got);
}
`;

/** The interactor of plan B Task 20: holds the number from the input, answers < > =. */
const INTERACTOR = `#include "testlib.h"
int main(int argc, char* argv[]) {
    registerInteraction(argc, argv);
    int secret = inf.readInt(), asked = 0;
    while (true) {
        int guess = ouf.readInt();
        if (++asked > 40) quitf(_wa, "too many guesses");
        if (guess == secret) { std::cout << "=" << std::endl; quitf(_ok, "found in %d", asked); }
        std::cout << (guess < secret ? "<" : ">") << std::endl;
    }
}
`;

/** A bridged `type: default` checker: argv is input, contestant output, answer; exit 0 AC, 1 WA. Symmetric in the last two, so argument order cannot hide a difference. */
const DEFAULT_CHECKER = `#include <fstream>
int main(int argc, char* argv[]) {
    if (argc < 4) return 1;
    std::ifstream got(argv[2]), want(argv[3]);
    long long a, b;
    if (!(got >> a) || !(want >> b)) return 1;
    return a == b ? 0 : 1;
}
`;

/** An interactor that ends without a verdict: both judges must report IE, never a contestant verdict. */
const CRASHING_INTERACTOR = 'int main() { return 3; }\n';

const SIGNATURE_LIBRARY =
  '#include "sol.h"\nlong long add(long long a, long long b) { return a + b; }\n';

const GUESSER =
  "lo, hi = 1, 1000\nwhile True:\n    m = (lo + hi) // 2\n    print(m, flush=True)\n    r = input()\n    if r == '=': break\n    if r == '<': lo = m + 1\n    else: hi = m - 1\n";

export const PARITY_PROBLEMS: ParityProblem[] = [
  {
    code: 'par_sum',
    data: { cases: [plain(1, 30), plain(2, 30), plain(3, 40)] },
    caseFiles: sums([
      [1, 2],
      [3, 4],
      [5, 6],
    ]),
    runs: [
      { language: 'PY3', name: 'ac', source: PY_SUM },
      { language: 'PY3', name: 'wa', source: 'print(0)\n' },
      { language: 'PY3', name: 'tle', source: 'while True:\n    pass\n' },
      { language: 'PY3', name: 'rte', source: 'print(1 // 0)\n' },
      { language: 'PY3', name: 'ir', source: 'import sys\nsys.exit(3)\n' },
      { language: 'PY3', name: 'ce', source: 'def broken(:\n    pass\n' },
      { language: 'CPP17', name: 'ac', source: CPP_SUM },
      {
        language: 'CPP17',
        name: 'mle',
        source:
          '#include <vector>\nint main(){std::vector<char> v; for(;;) v.resize(v.size() + (1 << 24), 1);}\n',
      },
      {
        language: 'CPP17',
        name: 'ole',
        source:
          '#include <cstdio>\nint main(){for(;;) std::puts("0123456789abcdef");}\n',
      },
      {
        language: 'CPP17',
        name: 'rte',
        source: 'int main(){volatile int* p = 0; *p = 1;}\n',
      },
    ],
  },
  {
    code: 'par_batch',
    data: {
      cases: [
        start(40),
        plain(1, null),
        plain(2, null),
        plain(3, null),
        end(),
        plain(4, 20),
        start(40),
        plain(5, null),
        plain(6, null),
        end(),
      ],
    },
    caseFiles: sums([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
    ]),
    runs: [
      { language: 'PY3', name: 'ac', source: PY_SUM },
      { language: 'PY3', name: 'fail-case-2', source: PY_SUM_UNLESS('(2, 2)') },
      { language: 'PY3', name: 'fail-case-4', source: PY_SUM_UNLESS('(4, 4)') },
      { language: 'PY3', name: 'fail-case-6', source: PY_SUM_UNLESS('(6, 6)') },
    ],
  },
  {
    code: 'par_zip',
    archive: 'tests.zip',
    data: { cases: [plain(1, 50), plain(2, 50)] },
    caseFiles: sums([
      [7, 8],
      [9, 10],
    ]),
    runs: [
      { language: 'CPP17', name: 'ac', source: CPP_SUM },
      {
        language: 'CPP17',
        name: 'wa',
        source:
          '#include <cstdio>\nint main(){long long a,b;std::scanf("%lld %lld",&a,&b);std::printf("%lld\\n",a-b);}\n',
      },
    ],
  },
  {
    code: 'par_pre',
    data: {
      cases: [
        plain(1, 10, { isPretest: true }),
        start(30, true),
        plain(2, null),
        plain(3, null),
        end(),
        plain(4, 30),
        plain(5, 30),
      ],
    },
    caseFiles: sums([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]),
    runs: [
      { language: 'PY3', name: 'ac', source: PY_SUM },
      {
        language: 'PY3',
        name: 'wa-on-pretest-1',
        source: PY_SUM_UNLESS('(1, 1)'),
      },
      {
        language: 'PY3',
        name: 'wa-in-pretest-batch',
        source: PY_SUM_UNLESS('(2, 2)'),
      },
      {
        language: 'PY3',
        name: 'wa-on-test-4',
        source: PY_SUM_UNLESS('(4, 4)'),
      },
    ],
  },
  {
    code: 'par_nonpartial',
    partial: false,
    data: { cases: [plain(1, 30), plain(2, 30), plain(3, 40)] },
    caseFiles: sums([
      [1, 2],
      [3, 4],
      [5, 6],
    ]),
    runs: [
      { language: 'PY3', name: 'fail-case-1', source: PY_SUM_UNLESS('(1, 2)') },
      { language: 'PY3', name: 'ac', source: PY_SUM },
    ],
  },
  {
    code: 'par_floats',
    data: {
      checker: 'floats',
      checkerArgs: { precision: 4 },
      cases: [plain(1, 100)],
    },
    caseFiles: { '1.in': '2\n', '1.out': '1.41421356\n' },
    runs: [
      {
        language: 'PY3',
        name: 'ac',
        source: 'print(f"{2 ** 0.5 + 1e-5:.8f}")\n',
      },
      {
        language: 'PY3',
        name: 'wa',
        source: 'print(f"{2 ** 0.5 + 1e-3:.8f}")\n',
      },
    ],
  },
  {
    code: 'par_floatsabs',
    data: { checker: 'floatsabs', cases: [plain(1, 100)] },
    caseFiles: { '1.in': '0\n', '1.out': '1000000.0\n' },
    runs: [
      { language: 'PY3', name: 'ac', source: 'print("1000000.0000001")\n' },
      { language: 'PY3', name: 'wa', source: 'print("1000000.01")\n' },
    ],
  },
  {
    code: 'par_floatsrel',
    data: { checker: 'floatsrel', cases: [plain(1, 100)] },
    caseFiles: { '1.in': '0\n', '1.out': '1000000.0\n' },
    runs: [
      { language: 'PY3', name: 'ac', source: 'print("1000000.0001")\n' },
      { language: 'PY3', name: 'wa', source: 'print("1000010.0")\n' },
    ],
  },
  {
    code: 'par_identical',
    data: { checker: 'identical', cases: [plain(1, 100)] },
    caseFiles: { '1.in': '1 2\n', '1.out': '1 2\n' },
    runs: [
      { language: 'PY3', name: 'ac', source: 'print(input())\n' },
      {
        language: 'PY3',
        name: 'pe+feedback',
        source: 'print(input().replace(" ", "  "))\n',
      },
    ],
  },
  {
    code: 'par_linecount',
    data: { checker: 'linecount', cases: [plain(1, 100)] },
    caseFiles: { '1.in': '4\n', '1.out': 'a\nb\nc\nd\n' },
    runs: [
      { language: 'PY3', name: 'ac', source: 'print("a\\nb\\nc\\nd")\n' },
      { language: 'PY3', name: 'half', source: 'print("a\\nb\\nx\\ny")\n' },
    ],
  },
  {
    code: 'par_testlib',
    data: {
      checker: 'bridged',
      customChecker: 'chk.cpp',
      cases: [plain(1, 100)],
    },
    dataFiles: { 'chk.cpp': TESTLIB_CHECKER },
    caseFiles: sums([[2, 3]]),
    runs: [
      { language: 'PY3', name: 'ac', source: PY_SUM },
      {
        language: 'PY3',
        name: 'partial',
        source: 'a, b = map(int, input().split())\nprint(a + b + 1)\n',
      },
      { language: 'PY3', name: 'wa+feedback', source: 'print(42)\n' },
    ],
  },
  {
    code: 'par_fileio',
    data: {
      grader: 'standard',
      graderArgs: {
        io_method: 'file',
        io_input_file: 'sum.inp',
        io_output_file: 'sum.out',
      },
      cases: [plain(1, 100)],
    },
    caseFiles: sums([[4, 5]]),
    runs: [
      {
        language: 'PY3',
        name: 'ac',
        source:
          "a, b = map(int, open('sum.inp').read().split())\nopen('sum.out', 'w').write(f'{a + b}\\n')\n",
      },
      {
        language: 'PY3',
        name: 'stdout-instead',
        source:
          "a, b = map(int, open('sum.inp').read().split())\nprint(a + b)\n",
      },
    ],
  },
  {
    code: 'par_interactive',
    data: {
      grader: 'interactive',
      customGrader: 'inter.cpp',
      cases: [plain(1, 100)],
    },
    dataFiles: { 'inter.cpp': INTERACTOR },
    caseFiles: { '1.in': '377\n', '1.out': '\n' },
    runs: [
      { language: 'PY3', name: 'ac', source: GUESSER },
      {
        language: 'PY3',
        name: 'wa',
        source: 'while True:\n    print(1, flush=True)\n    input()\n',
      },
      { language: 'PY3', name: 'tle', source: 'import time\ntime.sleep(10)\n' },
    ],
  },
  {
    code: 'par_signature',
    data: {
      grader: 'signature',
      customGrader: 'grader.cpp',
      customHeader: 'sol.h',
      cases: [plain(1, 100)],
    },
    dataFiles: {
      'sol.h': 'long long add(long long a, long long b);\n',
      'grader.cpp':
        '#include <cstdio>\n#include "sol.h"\nint main(){long long a,b;std::scanf("%lld %lld",&a,&b);std::printf("%lld\\n",add(a,b));}\n',
    },
    caseFiles: sums([[1, 2]]),
    runs: [
      {
        language: 'CPP17',
        name: 'ac',
        source: 'long long add(long long a, long long b) { return a + b; }\n',
      },
      {
        language: 'CPP17',
        name: 'ce-missing-function',
        source: 'long long other() { return 0; }\n',
      },
    ],
  },
  {
    code: 'par_shortcircuit',
    partial: false,
    data: {
      cases: [
        start(50),
        plain(1, null),
        plain(2, null),
        end(),
        plain(3, 20),
        start(30),
        plain(4, null),
        plain(5, null),
        end(),
      ],
    },
    caseFiles: sums([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]),
    runs: [
      { language: 'PY3', name: 'fail-case-1', source: PY_SUM_UNLESS('(1, 1)') },
      { language: 'PY3', name: 'ac', source: PY_SUM },
    ],
  },
  {
    code: 'par_default_checker',
    data: {
      checker: 'bridged',
      customChecker: 'chk_default.cpp',
      checkerArgs: { type: 'default' },
      cases: [plain(1, 100)],
    },
    dataFiles: { 'chk_default.cpp': DEFAULT_CHECKER },
    caseFiles: sums([[20, 22]]),
    runs: [
      { language: 'PY3', name: 'ac', source: PY_SUM },
      { language: 'PY3', name: 'wa', source: 'print(41)\n' },
    ],
  },
  {
    code: 'par_signature_main',
    data: {
      grader: 'signature',
      customGrader: 'grader.cpp',
      customHeader: 'sol.h',
      graderArgs: { allow_main: true },
      cases: [plain(1, 100)],
    },
    dataFiles: {
      'sol.h': 'long long add(long long a, long long b);\n',
      'grader.cpp': SIGNATURE_LIBRARY,
    },
    caseFiles: sums([[5, 6]]),
    runs: [
      {
        language: 'CPP17',
        name: 'ac',
        source:
          '#include <cstdio>\n#include "sol.h"\nint main(){long long a,b;std::scanf("%lld %lld",&a,&b);std::printf("%lld\\n",add(a,b));}\n',
      },
      {
        language: 'CPP17',
        name: 'wa',
        source:
          '#include <cstdio>\n#include "sol.h"\nint main(){long long a,b;std::scanf("%lld %lld",&a,&b);std::printf("%lld\\n",add(a,b)+1);}\n',
      },
    ],
  },
  {
    code: 'par_output_only',
    data: { grader: 'output_only', cases: [plain(1, 50), plain(2, 50)] },
    caseFiles: {
      '1.in': '1 2\n',
      '1.out': '3\n',
      '2.in': '0 3\n',
      '2.out': '3\n',
    },
    runs: [
      { language: 'TEXT', name: 'ac', source: '3\n' },
      { language: 'TEXT', name: 'wa', source: '4\n' },
      {
        language: 'OUTPUT',
        name: 'ac',
        source: '',
        file: { '1.out': '3\n', '2.out': '3\n' },
      },
      {
        language: 'OUTPUT',
        name: 'partial-missing-entry',
        source: '',
        file: { '1.out': '3\n' },
      },
    ],
  },
  {
    code: 'par_pre_contest',
    contest: PARITY_CONTEST,
    data: { cases: [plain(1, 50, { isPretest: true }), plain(2, 50)] },
    caseFiles: sums([
      [1, 1],
      [2, 2],
    ]),
    runs: [
      { language: 'PY3', name: 'ac', source: PY_SUM },
      {
        language: 'PY3',
        name: 'wrong-on-test-2-only',
        source: PY_SUM_UNLESS('(2, 2)'),
      },
    ],
  },
  {
    code: 'par_inter_crash',
    data: {
      grader: 'interactive',
      customGrader: 'inter_crash.cpp',
      cases: [plain(1, 100)],
    },
    dataFiles: { 'inter_crash.cpp': CRASHING_INTERACTOR },
    caseFiles: { '1.in': '377\n', '1.out': '\n' },
    runs: [{ language: 'PY3', name: 'ie', source: GUESSER }],
  },
];
