import type {
  GenerationLimits,
  GenerationPlan,
  GenerationProgram,
  GenerationTest,
  ProgramLimits,
} from '@libs/judging';
import {
  childOf,
  childrenOf,
  descendant,
  POLYGON_PACKAGE_MAX_BYTES,
} from '@libs/problems';
import type { XmlElement } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { languageKeyOf } from './polygon-languages';
import { resolveMemberPath, shown } from './polygon-package';
import { fileIoNamesOf, testNodesOf } from './polygon-tests';
import type { PlannedTest, TestPlan } from './polygon-tests';

const BYTES_PER_MIB = 1024 * 1024;
const KIB_PER_GIB = 1024 * 1024;
const SECONDS_PER_MINUTE = 60;

/** Generators and the validator: 10 s CPU, 20 s wall, 1 GiB. */
const AUXILIARY_LIMITS: ProgramLimits = {
  timeS: 10,
  wallS: 20,
  memoryKib: KIB_PER_GIB,
};
const MIN_SOLUTION_CPU_S = 1;
const SOLUTION_CPU_FACTOR = 2;
const SOLUTION_WALL_FACTOR = 3;
const SOLUTION_WALL_EXTRA_S = 1;
const MAX_FILE_BYTES = 256 * BYTES_PER_MIB;
const MAX_TOTAL_BYTES = 1024 * BYTES_PER_MIB;
/** The result zip becomes `tests.zip`, so it is bound like an uploaded archive (the api's `ARCHIVE_MAX_BYTES`, 512 MiB). */
const MAX_UPLOAD_BYTES = POLYGON_PACKAGE_MAX_BYTES;
const DEADLINE_BASE_S = 120;
const DEADLINE_PER_TEST_EXTRA_S = 2;
const DEADLINE_MAX_S = 30 * SECONDS_PER_MINUTE;

type HasMember = (path: string) => boolean;

/** A program's source as `problem.xml` declares it. */
interface SourceFile {
  path: string;
  type: string;
}

const sourceOf = (element: XmlElement | null): SourceFile | null => {
  const source = element && childOf(element, 'source');
  const { path, type } = source?.attributes ?? {};
  return path && type ? { path: resolveMemberPath(path), type } : null;
};

/** `files/gen-random.cpp` → `gen-random`: the name a test command uses for it. */
const baseNameOf = (path: string): string =>
  (path.split('/').pop() ?? path).replace(/\.[^.]*$/, '');

const executablesOf = (root: XmlElement): SourceFile[] =>
  childrenOf(descendant(root, 'executables') ?? root, 'executable').flatMap(
    (executable) => sourceOf(executable) ?? [],
  );

function mainSolutionOf(root: XmlElement): SourceFile {
  const main = childrenOf(
    descendant(root, 'solutions') ?? root,
    'solution',
  ).find((solution) => solution.attributes.tag === 'main');
  const source = sourceOf(main ?? null);
  if (!source) throw new PolygonImportError('no main solution');
  return source;
}

const validatorOf = (root: XmlElement): SourceFile | null =>
  sourceOf(childOf(descendant(root, 'validators') ?? root, 'validator'));

/** Test `index` is Polygon's 1-based number; it either reads a manual input or runs a generator with arguments. */
function generationTestOf(
  test: PlannedTest,
  node: XmlElement,
  hasMember: HasMember,
): GenerationTest {
  const index = test.index + 1;
  const base = {
    index,
    inputName: test.inputName,
    answerName: test.outputName,
    group: node.attributes.group ?? '',
    manualPath: '',
    generator: '',
    args: [] as string[],
  };
  if (node.attributes['from-file'] !== undefined)
    throw new PolygonImportError(
      'multi-file generators are not supported; build a full package',
      'package_needs_full',
    );
  if (node.attributes.method === 'manual') {
    if (!hasMember(test.inputPath))
      throw new PolygonImportError(
        `test ${index}: manual input ${shown(test.inputPath)} is missing from the package`,
      );
    return { ...base, manualPath: test.inputPath };
  }
  const [generator, ...args] = (node.attributes.cmd ?? '')
    .split(/\s+/)
    .filter(Boolean);
  if (node.attributes.method !== 'generated' || !generator)
    throw new PolygonImportError(`test ${index} has no generator command`);
  return { ...base, generator, args };
}

function programOf(
  name: string,
  role: GenerationProgram['role'],
  source: SourceFile,
  hasMember: HasMember,
): GenerationProgram {
  if (!hasMember(source.path))
    throw new PolygonImportError(
      `${shown(source.path)} is missing from the package`,
    );
  return {
    name,
    role,
    languageKey: languageKeyOf(source.type, source.path),
    sourcePath: source.path,
  };
}

function generatorsOf(
  root: XmlElement,
  tests: GenerationTest[],
  hasMember: HasMember,
): GenerationProgram[] {
  const executables = executablesOf(root);
  const names = new Set(tests.map((test) => test.generator).filter(Boolean));
  return [...names].map((name) => {
    const source = executables.find(
      (candidate) => baseNameOf(candidate.path) === name,
    );
    if (!source)
      throw new PolygonImportError(`generator ${shown(name)} not found`);
    return programOf(name, 'GENERATOR', source, hasMember);
  });
}

/** Every generator the tests name (first-use order), then the first validator, then the main solution; names are unique. */
function programsOf(
  root: XmlElement,
  tests: GenerationTest[],
  hasMember: HasMember,
): GenerationProgram[] {
  const validator = validatorOf(root);
  const main = mainSolutionOf(root);
  const programs = [
    ...generatorsOf(root, tests, hasMember),
    ...(validator
      ? [
          programOf(
            baseNameOf(validator.path),
            'VALIDATOR',
            validator,
            hasMember,
          ),
        ]
      : []),
    programOf(baseNameOf(main.path), 'SOLUTION', main, hasMember),
  ];
  const names = programs.map(({ name }) => name);
  const repeated = names.find((name, at) => names.indexOf(name) !== at);
  if (repeated)
    throw new PolygonImportError(`two programs are named ${shown(repeated)}`);
  return programs;
}

/** CPU = max(2 x TL, 1 s), wall = 3 x CPU + 1 s, memory = the problem's limit. */
export function solutionLimitsOf(
  timeLimitS: number,
  memoryLimitKib: number,
): ProgramLimits {
  const timeS = Math.max(SOLUTION_CPU_FACTOR * timeLimitS, MIN_SOLUTION_CPU_S);
  return {
    timeS,
    wallS: SOLUTION_WALL_FACTOR * timeS + SOLUTION_WALL_EXTRA_S,
    memoryKib: memoryLimitKib,
  };
}

/** `min(30 min, 120 s + tests x (solution CPU + 2 s))`, rounded up to whole seconds. */
export const deadlineOf = (
  testCount: number,
  solution: ProgramLimits,
): number =>
  Math.ceil(
    Math.min(
      DEADLINE_MAX_S,
      DEADLINE_BASE_S +
        testCount * (solution.timeS + DEADLINE_PER_TEST_EXTRA_S),
    ),
  );

const limitsOf = (plan: TestPlan): GenerationLimits => ({
  generator: AUXILIARY_LIMITS,
  validator: AUXILIARY_LIMITS,
  solution: solutionLimitsOf(plan.timeLimit, plan.memoryLimit),
  maxFileBytes: MAX_FILE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxUploadBytes: MAX_UPLOAD_BYTES,
});

/**
 * What a judge must run to turn a standard package into the tests of its full counterpart: the `tests` testset in
 * file order and the programs it needs. Pure; `hasMember` says whether the package holds a path. A package the judge
 * cannot be asked about (interactive, no main solution, unknown or multi-file generator, unsupported language,
 * missing manual input) is refused here, before anything is queued.
 */
export function buildGenerationPlan(
  root: XmlElement,
  testPlan: TestPlan,
  hasMember: HasMember,
): GenerationPlan {
  if (descendant(root, 'interactor'))
    throw new PolygonImportError(
      'interactive problems need a full package',
      'package_needs_full',
    );
  const nodes = testNodesOf(root);
  const tests = testPlan.tests.map((test) =>
    generationTestOf(test, nodes[test.index], hasMember),
  );
  const limits = limitsOf(testPlan);
  return {
    deadlineS: deadlineOf(tests.length, limits.solution),
    limits,
    programs: programsOf(root, tests, hasMember),
    tests,
    ...fileIoNamesOf(root),
  };
}
