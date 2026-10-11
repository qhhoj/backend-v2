import { Injectable } from '@nestjs/common';
import { ZipArchive, ZipError } from '@libs/problems';
import type { XmlElement } from '@libs/problems';
import { buildGenerationPlan } from './polygon-generation-plan';
import { generationBundle } from './polygon-generation-bundle';
import { PolygonImportError } from './polygon-import.error';
import type { PolygonPackage } from './polygon-package';
import { shown } from './polygon-package';
import type { PlannedTest, TestPlan } from './polygon-tests';
import { TestGenerationService } from './test-generation.service';

/** Where the generated `tests.zip` of a job waits, beside its package. */
export const generatedTestsPathOf = (packagePath: string): string =>
  packagePath.replace(/\.zip$/, '.tests.zip');

/** The judge's result must hold every input and answer the plan promised; a short zip is a judge fault, never imported. */
async function assertGeneratedTests(
  path: string,
  tests: PlannedTest[],
): Promise<void> {
  let zip: ZipArchive;
  try {
    zip = await ZipArchive.open(path);
  } catch (error) {
    if (error instanceof ZipError)
      throw new PolygonImportError(
        `the generated tests are not a valid zip: ${error.message}`,
      );
    throw error;
  }
  try {
    const missing = tests
      .flatMap((test) => [test.inputName, test.outputName])
      .find((name) => !zip.has(name));
    if (missing)
      throw new PolygonImportError(
        `the generated tests lack ${shown(missing)}`,
      );
  } finally {
    await zip.close();
  }
}

/** The tests of a Polygon standard package: planned from its problem.xml, generated on a judge, checked. */
@Injectable()
export class StandardPackageTests {
  constructor(private readonly generation: TestGenerationService) {}

  /** Writes the generated `tests.zip` (`01.inp`, `01.out`, ...) to `destination`. */
  async generate(
    pkg: PolygonPackage,
    source: { root: XmlElement; plan: TestPlan },
    destination: string,
  ): Promise<void> {
    const plan = buildGenerationPlan(source.root, source.plan, (path) =>
      pkg.has(path),
    );
    await this.generation.generate(
      plan,
      generationBundle(pkg, source.root, plan),
      destination,
    );
    await assertGeneratedTests(destination, source.plan.tests);
  }
}
