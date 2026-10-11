import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { ZipArchive, ZipError } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { parseXml, XML_LIMITS, XmlError } from '@libs/problems';
import type { XmlElement } from '@libs/problems';
import type { PlannedTest } from './polygon-tests';

export const TESTS_ARCHIVE = 'tests.zip';
export const CHECKER_FILE = 'checker.cpp';
export const INTERACTOR_FILE = 'interactor.cpp';
const PROBLEM_XML = 'problem.xml';
const MAX_SHOWN_PATH = 100;
export const shown = (name: string) => name.slice(0, MAX_SHOWN_PATH);

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
    throw new PolygonImportError(`invalid path in the package: ${shown(path)}`);
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
      await zip.close();
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
      throw new PolygonImportError(
        `${shown(name)} is larger than ${maxBytes} bytes`,
      );
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

  close(): Promise<void> {
    return this.zip.close();
  }

  private member(name: string): string {
    const member = resolveMemberPath(name);
    if (!this.zip.has(member))
      throw new PolygonImportError(`${shown(name)} not found in the package`);
    return member;
  }
}

/** A member of the package and the name it gets in a repacked zip. */
export interface RepackMember {
  from: string;
  to: string;
}

/** Copies package members into a new zip under new names; members are opened only when yazl reaches them, so memory stays at one entry. Every failure (missing member, lying size, corrupt data, closed package) destroys the output with a `PolygonImportError`; abandoning the output closes the member in flight. `missingMessage` words the error for a member the package lacks. */
export function repackMembers(
  pkg: PolygonPackage,
  members: RepackMember[],
  missingMessage: (path: string) => string,
): Readable {
  const zip = new ZipFile();
  /** yazl's typings say `NodeJS.ReadableStream`; at runtime it is a PassThrough. */
  const output = zip.outputStream as Readable;
  const fail = (error: unknown) => {
    output.destroy(asImportError(error) as Error);
  };
  zip.on('error', fail);
  let inFlight: Readable | null = null;
  output.on('close', () => inFlight?.destroy());
  const missing = members.find(({ from }) => !pkg.has(from));
  if (missing) {
    fail(new PolygonImportError(missingMessage(missing.from)));
    return output;
  }
  for (const { from, to } of members)
    zip.addReadStreamLazy(
      to,
      { size: pkg.sizeOf(from), compress: true },
      (callback) => {
        pkg.stream(from).then(
          (stream) => {
            if (output.destroyed) return void stream.destroy();
            inFlight = stream;
            stream.on('error', fail);
            callback(null, stream);
          },
          // yazl would emit an error on its own; failing the output directly keeps a single path.
          fail,
        );
      },
    );
  zip.end();
  return output;
}

/** Legacy repackaging: `tests/01` and `tests/01.a` become `01.inp` and `01.out`. */
export const repackTests = (
  pkg: PolygonPackage,
  tests: PlannedTest[],
): Readable =>
  repackMembers(
    pkg,
    tests.flatMap((test) => [
      { from: test.inputPath, to: test.inputName },
      { from: test.answerPath, to: test.outputName },
    ]),
    (path) => `not full package: ${shown(path)} is missing`,
  );
