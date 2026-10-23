import { buildZip } from '@libs/problems/testing';
import type { ZipTestEntry } from '@libs/problems/testing';

export interface PolygonFixture {
  tests: Array<{
    input: string;
    answer: string;
    points?: number;
    group?: string;
  }>;
  groups?: Array<{
    name: string;
    points: number;
    policy: 'complete-group' | 'each-test';
    dependencies?: string[];
  }>;
  /** Omitted = `std::wcmp.cpp`; `{ path }` without a name = a custom checker; `null` = no checker element. */
  checker?: { name?: string; path: string } | null;
  interactor?: string | null;
  /** `<resources>` files, each also put in the package unless `omitEntries` drops it. */
  resources?: Array<{ path: string; type?: string; content?: string }>;
  judging?: {
    inputFile?: string;
    outputFile?: string;
    percent?: boolean;
    /** Polygon's `run-count`; omitted = no attribute (packages from before Polygon wrote it). */
    runCount?: string;
  };
  timeLimitMs?: number;
  memoryLimitBytes?: number;
  statements?: Array<{
    language: string;
    name: string;
    properties: Record<string, unknown>;
    images?: Record<string, Buffer>;
  }>;
  solution?: { path: string; type: string; code: string } | null;
  files?: Record<string, Buffer | string>;
  withProblemXml?: boolean;
  /** Rewrites the generated problem.xml (standard packages add generated tests and executables). */
  transformXml?: (xml: string) => string;
  /** Entry names left out of the package (non-full packages). */
  omitEntries?: string[];
}

const attribute = (name: string, value: string | number | undefined) =>
  value === undefined ? '' : ` ${name}="${String(value)}"`;

/** Where a fixture's checker source lives unless it names another path. */
const DEFAULT_CHECKER_PATH = 'files/check.cpp';
const checkerXml = (fixture: PolygonFixture): string => {
  if (fixture.checker === null) return '';
  const name =
    fixture.checker === undefined ? 'std::wcmp.cpp' : fixture.checker.name;
  const path = fixture.checker?.path ?? DEFAULT_CHECKER_PATH;
  return `<checker${attribute('name', name)} type="testlib"><source path="${path}" type="cpp.g++17"/></checker>`;
};
const interactorXml = (fixture: PolygonFixture): string =>
  fixture.interactor
    ? `<interactor><source path="${fixture.interactor}" type="cpp.g++17"/></interactor>`
    : '';
const resourcesXml = ({ resources }: PolygonFixture): string =>
  resources
    ? `<files><resources>${resources.map((file) => `<file path="${file.path}"${attribute('type', file.type)}/>`).join('')}</resources></files>`
    : '';
const solutionXml = (fixture: PolygonFixture): string =>
  fixture.solution === null
    ? ''
    : `<solutions><solution tag="main"><source path="${fixture.solution?.path ?? 'solutions/main.cpp'}" type="${fixture.solution?.type ?? 'cpp.g++17'}"/></solution></solutions>`;
const statementsXml = (fixture: PolygonFixture): string =>
  (fixture.statements ?? [])
    .map(
      (statement) =>
        `<statement charset="UTF-8" language="${statement.language}" mathjax="true" path="statements/${statement.language}/problem.tex" type="application/x-tex"/>`,
    )
    .join('');
const namesXml = (fixture: PolygonFixture): string =>
  (fixture.statements ?? [])
    .map(
      (statement) =>
        `<name language="${statement.language}" value="${statement.name}"/>`,
    )
    .join('');
const testsXml = (fixture: PolygonFixture): string =>
  fixture.tests
    .map(
      (test) =>
        `<test method="manual"${attribute('points', test.points)}${attribute('group', test.group)}/>`,
    )
    .join('');
const dependenciesXml = (dependencies: string[] | undefined): string =>
  dependencies?.length
    ? `<dependencies>${dependencies.map((name) => `<dependency group="${name}"/>`).join('')}</dependencies>`
    : '';
const groupsXml = (fixture: PolygonFixture): string =>
  (fixture.groups ?? [])
    .map(
      (group) =>
        `<group name="${group.name}" points="${group.points}" points-policy="${group.policy}">${dependenciesXml(group.dependencies)}</group>`,
    )
    .join('');
const judgingAttributes = ({ judging }: PolygonFixture): string =>
  `${attribute('input-file', judging?.inputFile ?? '')}${attribute('output-file', judging?.outputFile ?? '')}${attribute('run-count', judging?.runCount)}${attribute('treat-points-from-checker-as-percent', judging?.percent ? 'true' : 'false')}`;

export function buildProblemXml(fixture: PolygonFixture): string {
  const groups = groupsXml(fixture);
  return `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<problem revision="3" short-name="sum">
<names>${namesXml(fixture)}</names>
<statements>${statementsXml(fixture)}</statements>
<judging cpu-name="Intel"${judgingAttributes(fixture)}>
<testset name="tests"><time-limit>${fixture.timeLimitMs ?? 1000}</time-limit><memory-limit>${fixture.memoryLimitBytes ?? 268435456}</memory-limit><test-count>${fixture.tests.length}</test-count>
<input-path-pattern>tests/%02d</input-path-pattern><answer-path-pattern>tests/%02d.a</answer-path-pattern>
<tests>${testsXml(fixture)}</tests>${groups ? `<groups>${groups}</groups>` : ''}</testset>
</judging>
${resourcesXml(fixture)}
<assets>${checkerXml(fixture)}${interactorXml(fixture)}${solutionXml(fixture)}</assets>
</problem>`;
}

const testEntries = (fixture: PolygonFixture): ZipTestEntry[] =>
  fixture.tests.flatMap((test, index) => {
    const label = String(index + 1).padStart(2, '0');
    return [
      { name: `tests/${label}`, content: test.input },
      { name: `tests/${label}.a`, content: test.answer },
    ];
  });
const checkerAndInteractorEntries = (
  fixture: PolygonFixture,
): ZipTestEntry[] => [
  ...(fixture.checker === null
    ? []
    : [
        {
          name: fixture.checker?.path ?? DEFAULT_CHECKER_PATH,
          content: '// checker',
        },
      ]),
  ...(fixture.interactor
    ? [{ name: fixture.interactor, content: '// interactor' }]
    : []),
];
const statementEntries = (fixture: PolygonFixture): ZipTestEntry[] =>
  (fixture.statements ?? []).flatMap((statement) => {
    const folder = `statements/${statement.language}`;
    return [
      {
        name: `${folder}/problem.tex`,
        content: '\\begin{problem}\\end{problem}',
      },
      {
        name: `${folder}/problem-properties.json`,
        content: JSON.stringify(statement.properties),
      },
      ...Object.entries(statement.images ?? {}).map(([name, content]) => ({
        name: `${folder}/${name}`,
        content,
      })),
    ];
  });
const solutionEntries = (fixture: PolygonFixture): ZipTestEntry[] =>
  fixture.solution === null
    ? []
    : [
        {
          name: fixture.solution?.path ?? 'solutions/main.cpp',
          content: fixture.solution?.code ?? 'int main() {}',
        },
      ];

/** A full package: problem.xml, tests, checker/interactor sources, statements with problem-properties.json and images, the main solution. */
export function buildPolygonPackage(fixture: PolygonFixture): Buffer {
  const entries: ZipTestEntry[] = [
    ...(fixture.withProblemXml === false
      ? []
      : [
          {
            name: 'problem.xml',
            content: (fixture.transformXml ?? ((xml) => xml))(
              buildProblemXml(fixture),
            ),
          },
        ]),
    ...testEntries(fixture),
    ...checkerAndInteractorEntries(fixture),
    ...(fixture.resources ?? []).map(({ path, content }) => ({
      name: path,
      content: content ?? `// ${path}`,
    })),
    ...statementEntries(fixture),
    ...solutionEntries(fixture),
    ...Object.entries(fixture.files ?? {}).map(([name, content]) => ({
      name,
      content,
    })),
  ];
  const omitted = new Set(fixture.omitEntries ?? []);
  return buildZip(entries.filter((entry) => !omitted.has(entry.name)));
}

export const properties = (overrides: Record<string, unknown> = {}) => ({
  legend: 'Add $a$ and $b$.',
  input: 'Two integers.',
  output: 'Their sum.',
  interaction: null,
  scoring: null,
  notes: '',
  tutorial: '',
  sampleTests: [{ input: '1 2\n', output: '3\n' }],
  ...overrides,
});
