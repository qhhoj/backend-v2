import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { StatementLanguage } from '@libs/database';
import {
  findDisallowedCharacter,
  isSvgWithinLimits,
  MAX_MARKDOWN_LENGTH,
  sniffImage,
  SVG_MAX_BYTES,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { renderMarkdown, RenderLimitError, sanitizeSvg } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { PolygonImportError } from './polygon-import.error';
import {
  IMAGE_MAX_BYTES,
  resolveMemberPath,
  SOURCE_MAX_BYTES,
} from './polygon-package';
import type { PolygonPackage } from './polygon-package';
import { childOf, descendant, descendants } from './polygon-xml';
import type { XmlElement } from './polygon-xml';

export interface ProblemProperties {
  legend: string;
  input: string;
  output: string;
  interaction: string | null;
  scoring: string | null;
  notes: string;
  tutorial: string | null;
  sampleTests: Array<{ input: string; output: string }>;
}
export type TexToMarkdown = (tex: string) => Promise<string>;
export type ImageSaver = (bytes: Buffer, name: string) => Promise<string>;
export interface ImportedStatements {
  name: string;
  description: string;
  translations: Array<{
    language: StatementLanguage;
    name: string;
    description: string;
  }>;
  tutorial: string;
}
interface StatementSource {
  language: string;
  name: string;
  folder: string;
  properties: ProblemProperties;
}

const MAX_NAME_LENGTH = 100;
const fence = (text: string, language = '') =>
  `\`\`\`${language}\n${text}\n\`\`\`\n`;

/** Legacy `parse_problem_properties`: English headings whatever the statement language. */
export async function buildDescription(
  properties: ProblemProperties,
  texToMarkdown: TexToMarkdown,
): Promise<string> {
  const parts = [
    await texToMarkdown(properties.legend),
    '\n## Input\n\n',
    await texToMarkdown(properties.input),
    '\n## Output\n\n',
    await texToMarkdown(properties.output),
  ];
  if (properties.interaction !== null)
    parts.push(
      '\n## Interaction\n\n',
      await texToMarkdown(properties.interaction),
    );
  if (properties.scoring !== null)
    parts.push('\n## Scoring\n\n', await texToMarkdown(properties.scoring));
  properties.sampleTests.forEach((sample, position) =>
    parts.push(
      `\n## Sample Input ${position + 1}\n\n`,
      fence(sample.input.trim()),
      `\n## Sample Output ${position + 1}\n\n`,
      fence(sample.output.trim()),
    ),
  );
  if (properties.notes !== '')
    parts.push('\n## Notes\n\n', await texToMarkdown(properties.notes));
  return parts.join('');
}

/** Every pattern is bounded: an unterminated `![image](` or `<img` rescans at most 500 or 1000 characters from each start. */
const MARKDOWN_IMAGE = /!\[image\]\(([^)\n]{1,500})\)/g;
const IMG_TAG = /<\s*img[^>]{0,1000}>/gi;
const IMG_SRC = /(\ssrc\s*=\s*)(["'])([^"'\n]*)\2/i;
const MARKDOWN_IMAGE_START = /!\[image\]\(/g;
const IMG_TAG_START = /<\s*img\b/gi;
const SRC_ATTRIBUTE = /\ssrc\s*=/gi;
const countOf = (pattern: RegExp, text: string) =>
  [...text.matchAll(pattern)].length;
/** The one `src` of an `<img>` tag, or null when the tag has none, several, or one this parser does not understand (unquoted, mixed quotes). */
const srcMatch = (tag: string) =>
  countOf(SRC_ATTRIBUTE, tag) === 1 ? IMG_SRC.exec(tag) : null;

/** Image bytes a visitor's browser will get: type from the bytes, SVG sanitized. The extension of `name` follows the sniffed type. */
export function prepareImage(
  bytes: Buffer,
  name: string,
): { content: Buffer; name: string } {
  const kind = sniffImage(bytes);
  if (!kind)
    throw new PolygonImportError(
      `not a supported image: ${name.slice(0, 100)}`,
    );
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  if (kind !== 'svg') return { content: bytes, name: `${stem}.${kind}` };
  const svg = bytes.toString('utf8');
  if (bytes.length > SVG_MAX_BYTES || !isSvgWithinLimits(svg))
    throw new PolygonImportError(
      `SVG is too large or too complex: ${name.slice(0, 100)}`,
    );
  return {
    content: Buffer.from(sanitizeSvg(svg), 'utf8'),
    name: `${stem}.svg`,
  };
}

/** Legacy `process_images`: each referenced image must exist in the package inside the statement's own folder; it is sniffed, sanitized and re-hosted, and identical bytes share one url. `folder` must be an already resolved package path. */
export async function rehostImages(
  text: string,
  folder: string,
  pkg: PolygonPackage,
  saveImage: ImageSaver,
): Promise<string> {
  const byDigest = new Map<string, string>();
  const urls = new Map<string, string>();
  const rehost = async (imagePath: string): Promise<void> => {
    if (urls.has(imagePath)) return;
    const packagePath = resolveMemberPath(imagePath, folder);
    if (folder !== '.' && !packagePath.startsWith(`${folder}/`))
      throw new PolygonImportError(
        `image outside the statement folder: ${imagePath.slice(0, 100)}`,
      );
    if (!pkg.has(packagePath))
      throw new PolygonImportError(
        `image not found in the package: ${imagePath.slice(0, 100)}`,
      );
    const bytes = await pkg.read(packagePath, IMAGE_MAX_BYTES);
    const digest = createHash('sha1').update(bytes).digest('hex');
    let url = byDigest.get(digest);
    if (!url) {
      const image = prepareImage(bytes, posix.basename(imagePath));
      url = await saveImage(image.content, image.name);
      byDigest.set(digest, url);
    }
    urls.set(imagePath, url);
  };
  const markdownPaths = [...text.matchAll(MARKDOWN_IMAGE)].map(
    (match) => match[1],
  );
  const tags = [...text.matchAll(IMG_TAG)].map((match) => match[0]);
  const tagPaths = tags.flatMap((tag) => srcMatch(tag)?.[3] ?? []);
  if (
    markdownPaths.length !== countOf(MARKDOWN_IMAGE_START, text) ||
    tagPaths.length !== countOf(IMG_TAG_START, text)
  )
    throw new PolygonImportError(
      'unsupported image reference in the statement',
    );
  for (const imagePath of [...markdownPaths, ...tagPaths])
    await rehost(imagePath);
  return text
    .replace(
      MARKDOWN_IMAGE,
      (match, imagePath: string) => `![image](${urls.get(imagePath)})`,
    )
    .replace(IMG_TAG, (tag) =>
      tag.replace(
        IMG_SRC,
        (source, lead: string, quote: string, imagePath: string) =>
          `${lead}${quote}${urls.get(imagePath)}${quote}`,
      ),
    );
}

/** The editor's statement path: length, disallowed characters and the render budgets (`RenderLimitError`), each failure an import error naming `label`; returns the HTML the editor would store. */
export function renderStatement(
  text: string,
  style: RenderStyle,
  label: string,
): string {
  if (text.length > MAX_MARKDOWN_LENGTH)
    throw new PolygonImportError(
      `${label} is longer than ${MAX_MARKDOWN_LENGTH} characters`,
    );
  const disallowed = findDisallowedCharacter(text);
  if (disallowed !== null)
    throw new PolygonImportError(
      `${label} has disallowed characters: ${disallowed}`,
    );
  try {
    return renderMarkdown(text, style);
  } catch (error) {
    if (error instanceof RenderLimitError)
      throw new PolygonImportError(`${label}: ${error.message}`);
    throw error;
  }
}

/** `renderStatement` for callers that only need the limits checked. */
export function assertStatementMarkdown(
  text: string,
  style: RenderStyle,
  label: string,
): void {
  renderStatement(text, style, label);
}

/** The editor's rules for a statement name: 1..100 characters, no disallowed ones. */
function assertStatementName(name: string, language: string): void {
  if (name.length < 1 || name.length > MAX_NAME_LENGTH)
    throw new PolygonImportError(
      `statement name for ${language} must be 1 to ${MAX_NAME_LENGTH} characters`,
    );
  if (findDisallowedCharacter(name) !== null)
    throw new PolygonImportError(
      `statement name for ${language} has disallowed characters`,
    );
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

/** problem-properties.json is untrusted: the shape is checked before any field is used. */
function parseProperties(json: string, path: string): ProblemProperties {
  let value: Partial<Record<keyof ProblemProperties, unknown>>;
  try {
    value = JSON.parse(json) as typeof value;
  } catch {
    throw new PolygonImportError(`${path} is not valid JSON`);
  }
  const { sampleTests } = value ?? {};
  if (
    ![value?.legend, value?.input, value?.output, value?.notes].every(
      isString,
    ) ||
    !isNullableString(value.interaction ?? null) ||
    !isNullableString(value.scoring ?? null) ||
    !isNullableString(value.tutorial ?? null) ||
    !Array.isArray(sampleTests) ||
    !sampleTests.every(
      (sample: Record<string, unknown> | null) =>
        isString(sample?.input) && isString(sample.output),
    )
  )
    throw new PolygonImportError(`${path} has an unexpected shape`);
  return value as unknown as ProblemProperties;
}

/** Legacy `parse_statements` in its non-interactive form: every choice comes from the job. The result passes the editor's statement limits. */
export async function parseStatements(
  root: XmlElement,
  pkg: PolygonPackage,
  job: PolygonImportJob,
  texToMarkdown: TexToMarkdown,
  saveImage: ImageSaver,
): Promise<ImportedStatements> {
  const nodes = descendants(
    root,
    'statement',
    (candidate) => candidate.attributes.type === 'application/x-tex',
  );
  if (!nodes.length) throw new PolygonImportError('statement not found');
  const sources: StatementSource[] = [];
  for (const node of nodes) {
    const language = node.attributes.language ?? 'unknown';
    if (sources.some((source) => source.language === language))
      throw new PolygonImportError(
        `two statements in the language ${language}`,
      );
    const folder = posix.dirname(resolveMemberPath(node.attributes.path ?? ''));
    const propertiesPath = resolveMemberPath('problem-properties.json', folder);
    if (!pkg.has(propertiesPath))
      throw new PolygonImportError(
        `problem-properties.json not found at path ${propertiesPath}`,
      );
    const name =
      descendant(
        root,
        'name',
        (candidate) => candidate.attributes.language === language,
      )?.attributes.value ?? '';
    assertStatementName(name, language);
    sources.push({
      language,
      name,
      folder,
      properties: parseProperties(
        await pkg.readText(propertiesPath, SOURCE_MAX_BYTES),
        propertiesPath,
      ),
    });
  }
  const mainLanguage =
    sources.length === 1 ? sources[0].language : job.mainStatementLanguage;
  if (
    !mainLanguage ||
    !sources.some((source) => source.language === mainLanguage)
  )
    throw new PolygonImportError(
      `invalid main statement language ${mainLanguage ?? '(none)'}`,
    );
  const style: RenderStyle = job.isFullMarkup ? 'problem-full' : 'problem';
  const result: ImportedStatements = {
    name: '',
    description: '',
    translations: [],
    tutorial: '',
  };
  for (const source of sources) {
    const description = await rehostImages(
      await buildDescription(source.properties, texToMarkdown),
      source.folder,
      pkg,
      saveImage,
    );
    assertStatementMarkdown(description, style, `statement ${source.language}`);
    if (source.language === mainLanguage) {
      result.name = source.name;
      result.description = description;
      continue;
    }
    /** Languages come from problem.xml: `constructor` or `__proto__` must not resolve through the prototype. */
    const siteLanguage = Object.hasOwn(job.statementLanguages, source.language)
      ? job.statementLanguages[source.language]
      : undefined;
    if (!siteLanguage)
      throw new PolygonImportError(
        `invalid site language for ${source.language}`,
      );
    if (
      result.translations.some(
        (translation) => translation.language === siteLanguage,
      )
    )
      throw new PolygonImportError(
        `two statements map to the site language ${siteLanguage}`,
      );
    result.translations.push({
      language: siteLanguage,
      name: source.name,
      description,
    });
  }
  const tutorials = sources.filter(
    (source) =>
      typeof source.properties.tutorial === 'string' &&
      source.properties.tutorial !== '',
  );
  const tutorialSource =
    tutorials.length > 1
      ? tutorials.find((source) => source.language === job.tutorialLanguage)
      : tutorials[0];
  if (tutorials.length > 1 && !tutorialSource)
    throw new PolygonImportError(
      `invalid main tutorial language ${job.tutorialLanguage ?? '(none)'}`,
    );
  if (tutorialSource) {
    result.tutorial = await rehostImages(
      await texToMarkdown(tutorialSource.properties.tutorial!),
      tutorialSource.folder,
      pkg,
      saveImage,
    );
    assertStatementMarkdown(result.tutorial, 'solution', 'tutorial');
  }
  return result;
}

/** Legacy `parse_solutions`: the main solution's source, with the Polygon source type for the fence. */
export async function mainSolution(
  root: XmlElement,
  pkg: PolygonPackage,
): Promise<{ code: string; sourceType: string }> {
  const solution = descendant(
    root,
    'solution',
    (candidate) => candidate.attributes.tag === 'main',
  );
  const source = solution && childOf(solution, 'source');
  if (!source?.attributes.path)
    throw new PolygonImportError('main solution not found');
  return {
    code: (await pkg.readText(source.attributes.path, SOURCE_MAX_BYTES)).trim(),
    sourceType: source.attributes.type ?? '',
  };
}

const FENCE_LANGUAGES = ['cpp', 'python', 'java'];
export function withMainSolution(
  tutorial: string,
  code: string,
  sourceType: string,
): string {
  const language =
    FENCE_LANGUAGES.find((prefix) => sourceType.startsWith(prefix)) ?? '';
  return `${tutorial.trimEnd()}\n\n<blockquote class="spoiler">\n${fence(code, language)}</blockquote>\n`;
}
