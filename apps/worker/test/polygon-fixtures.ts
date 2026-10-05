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
  judging?: { inputFile?: string; outputFile?: string; percent?: boolean };
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
  /** Entry names left out of the package (non-full packages). */
  omitEntries?: string[];
}

const attribute = (name: string, value: string | number | undefined) =>
  value === undefined ? '' : ` ${name}="${String(value)}"`;

export function buildProblemXml(fixture: PolygonFixture): string {
  const checkerName =
    fixture.checker === undefined ? 'std::wcmp.cpp' : fixture.checker?.name;
  const checker =
    fixture.checker === null
      ? ''
      : `<checker${attribute('name', checkerName)} type="testlib"><source path="${fixture.checker?.path ?? 'files/check.cpp'}" type="cpp.g++17"/></checker>`;
  const interactor = fixture.interactor
    ? `<interactor><source path="${fixture.interactor}" type="cpp.g++17"/></interactor>`
    : '';
  const solution =
    fixture.solution === null
      ? ''
      : `<solutions><solution tag="main"><source path="${fixture.solution?.path ?? 'solutions/main.cpp'}" type="${fixture.solution?.type ?? 'cpp.g++17'}"/></solution></solutions>`;
  const statements = (fixture.statements ?? [])
    .map(
      (statement) =>
        `<statement charset="UTF-8" language="${statement.language}" mathjax="true" path="statements/${statement.language}/problem.tex" type="application/x-tex"/>`,
    )
    .join('');
  const names = (fixture.statements ?? [])
    .map(
      (statement) =>
        `<name language="${statement.language}" value="${statement.name}"/>`,
    )
    .join('');
  const tests = fixture.tests
    .map(
      (test) =>
        `<test method="manual"${attribute('points', test.points)}${attribute('group', test.group)}/>`,
    )
    .join('');
  const groups = (fixture.groups ?? [])
    .map(
      (group) =>
        `<group name="${group.name}" points="${group.points}" points-policy="${group.policy}">${group.dependencies?.length ? `<dependencies>${group.dependencies.map((name) => `<dependency group="${name}"/>`).join('')}</dependencies>` : ''}</group>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<problem revision="3" short-name="sum">
<names>${names}</names>
<statements>${statements}</statements>
<judging cpu-name="Intel"${attribute('input-file', fixture.judging?.inputFile ?? '')}${attribute('output-file', fixture.judging?.outputFile ?? '')}${attribute('treat-points-from-checker-as-percent', fixture.judging?.percent ? 'true' : 'false')}>
<testset name="tests"><time-limit>${fixture.timeLimitMs ?? 1000}</time-limit><memory-limit>${fixture.memoryLimitBytes ?? 268435456}</memory-limit><test-count>${fixture.tests.length}</test-count>
<input-path-pattern>tests/%02d</input-path-pattern><answer-path-pattern>tests/%02d.a</answer-path-pattern>
<tests>${tests}</tests>${groups ? `<groups>${groups}</groups>` : ''}</testset>
</judging>
<assets>${checker}${interactor}${solution}</assets>
</problem>`;
}

/** A full package: problem.xml, tests, checker/interactor sources, statements with problem-properties.json and images, the main solution. */
export function buildPolygonPackage(fixture: PolygonFixture): Buffer {
  const entries: ZipTestEntry[] = [];
  if (fixture.withProblemXml !== false)
    entries.push({ name: 'problem.xml', content: buildProblemXml(fixture) });
  fixture.tests.forEach((test, index) => {
    const label = String(index + 1).padStart(2, '0');
    entries.push(
      { name: `tests/${label}`, content: test.input },
      { name: `tests/${label}.a`, content: test.answer },
    );
  });
  if (fixture.checker !== null)
    entries.push({
      name: fixture.checker?.path ?? 'files/check.cpp',
      content: '// checker',
    });
  if (fixture.interactor)
    entries.push({ name: fixture.interactor, content: '// interactor' });
  for (const statement of fixture.statements ?? []) {
    entries.push({
      name: `statements/${statement.language}/problem.tex`,
      content: '\\begin{problem}\\end{problem}',
    });
    entries.push({
      name: `statements/${statement.language}/problem-properties.json`,
      content: JSON.stringify(statement.properties),
    });
    for (const [name, content] of Object.entries(statement.images ?? {}))
      entries.push({
        name: `statements/${statement.language}/${name}`,
        content,
      });
  }
  if (fixture.solution !== null)
    entries.push({
      name: fixture.solution?.path ?? 'solutions/main.cpp',
      content: fixture.solution?.code ?? 'int main() {}',
    });
  for (const [name, content] of Object.entries(fixture.files ?? {}))
    entries.push({ name, content });
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
