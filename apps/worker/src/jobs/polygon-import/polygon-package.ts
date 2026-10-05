import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { ZipArchive, ZipError } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { parseXml, XML_LIMITS, XmlError } from './polygon-xml';
import type { XmlElement } from './polygon-xml';
import type { PlannedTest } from './polygon-tests';

export const TESTS_ARCHIVE = 'tests.zip';
export const CHECKER_FILE = 'checker.cpp';
export const INTERACTOR_FILE = 'interactor.cpp';
/** Every member we inflate into memory has a cap checked against the central directory before reading. */
export const SOURCE_MAX_BYTES = 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PROBLEM_XML = 'problem.xml';
const MAX_SHOWN_PATH = 100;

const asImportError = (error: unknown): unknown =>
  error instanceof ZipError || error instanceof XmlError
    ? new PolygonImportError(error.message)
    : error;

/** Member paths come from the attacker-controlled problem.xml: only plain relative names inside the package (or, with `folder`, inside that folder) resolve; `..`, absolute paths, backslashes and NUL never do. */
export function resolveMemberPath(path: string, folder?: string): string {
  const resolved = posix.normalize(folder ? `${folder}/${path}` : path);
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').includes('..') ||
    resolved === '.'
  )
    throw new PolygonImportError(
      `invalid path in the package: ${JSON.stringify(path.slice(0, MAX_SHOWN_PATH))}`,
    );
  return resolved;
}

/** Read-only view of a Polygon full package (a zip with problem.xml at its root); members are read through the bounded zip reader, never extracted. */
export class PolygonPackage {
  private constructor(private readonly zip: ZipArchive) {}

  static async open(path: string): Promise<PolygonPackage> {
    let zip: ZipArchive;
    try {
      zip = await ZipArchive.open(path);
    } catch (error) {
      throw asImportError(error);
    }
    if (!zip.has(PROBLEM_XML)) {
      zip.close();
      throw new PolygonImportError('problem.xml not found');
    }
    return new PolygonPackage(zip);
  }

  has(name: string): boolean {
    try {
      return this.zip.has(resolveMemberPath(name));
    } catch {
      return false;
    }
  }

  sizeOf(name: string): number {
    return this.zip.sizeOf(this.member(name));
  }

  async read(name: string, maxBytes: number): Promise<Buffer> {
    const member = this.member(name);
    if (this.zip.sizeOf(member) > maxBytes)
      throw new PolygonImportError(`${name} is larger than ${maxBytes} bytes`);
    try {
      return await this.zip.read(member);
    } catch (error) {
      throw asImportError(error);
    }
  }

  async readText(name: string, maxBytes: number): Promise<string> {
    return (await this.read(name, maxBytes)).toString('utf8');
  }

  async stream(name: string): Promise<Readable> {
    const member = this.member(name);
    try {
      return await this.zip.stream(member);
    } catch (error) {
      throw asImportError(error);
    }
  }

  async problemXml(): Promise<XmlElement> {
    try {
      return parseXml(await this.readText(PROBLEM_XML, XML_LIMITS.maxBytes));
    } catch (error) {
      throw asImportError(error);
    }
  }

  close(): void {
    this.zip.close();
  }

  private member(name: string): string {
    const member = resolveMemberPath(name);
    if (!this.zip.has(member))
      throw new PolygonImportError(`${name} not found in the package`);
    return member;
  }
}

/** Legacy repackaging: `tests/01` and `tests/01.a` become `01.inp` and `01.out`; members are opened only when yazl reaches them, so memory stays at one entry. */
export function repackTests(
  pkg: PolygonPackage,
  tests: PlannedTest[],
): Readable {
  const zip = new ZipFile();
  /** yazl's typings say `NodeJS.ReadableStream`; at runtime it is a PassThrough. */
  const output = zip.outputStream as Readable;
  for (const test of tests)
    for (const [from, to] of [
      [test.inputPath, test.inputName],
      [test.answerPath, test.outputName],
    ] as const) {
      if (!pkg.has(from)) {
        output.destroy(
          new PolygonImportError(`not full package: ${from} is missing`),
        );
        return output;
      }
      zip.addReadStreamLazy(
        to,
        { size: pkg.sizeOf(from), compress: true },
        (callback) => {
          pkg.stream(from).then(
            (stream) => callback(null, stream),
            (error: Error) => callback(error, undefined as never),
          );
        },
      );
    }
  zip.end();
  return output;
}
