import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { StatementLanguage } from '@libs/database';
import {
  findDisallowedCharacter,
  IMAGE_MAX_BYTES,
  isSvgWithinLimits,
  MAX_MARKDOWN_LENGTH,
  sniffImage,
  SOURCE_MAX_BYTES,
  SVG_MAX_BYTES,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { renderMarkdown, RenderLimitError, sanitizeSvg } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { PolygonImportError } from './polygon-import.error';
import { resolveMemberPath } from './polygon-package';
import type { PolygonPackage } from './polygon-package';
import { childOf, descendant, descendants } from '@libs/problems';
import type { XmlElement } from '@libs/problems';

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
/** Re-hosted image bytes per import, all statements and the tutorial together: each image is capped, but a compressed package can hold thousands of them, and they are saved outside the problem's storage meter. */
const IMPORT_IMAGES_MAX_BYTES = 64 * 1024 * 1024;

/** `saveImage` that fails the import once the bytes it saved would pass `maxBytes`. */
export function withImageBudget(
  saveImage: ImageSaver,
  maxBytes: number,
): ImageSaver {
  let savedBytes = 0;
  return async (bytes, name) => {
    savedBytes += bytes.length;
    if (savedBytes > maxBytes)
      throw new PolygonImportError(
        `statement images exceed ${maxBytes} bytes in total`,
      );
    return saveImage(bytes, name);
  };
}
export interface ImportedStatements {
  name: string;
  description: string;
  descriptionHtml: string;
  translations: Array<{
    language: StatementLanguage;
    name: string;
    description: string;
    descriptionHtml: string;
  }>;
  /** Markdown only: the caller appends the main solution, then renders the whole. */
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
function prepareImage(
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

const REQUIRED_TEXT_KEYS = ['legend', 'input', 'output', 'notes'] as const;
const OPTIONAL_TEXT_KEYS = ['interaction', 'scoring', 'tutorial'] as const;

const isSampleTest = (sample: unknown): boolean => {
  const fields = sample as Record<string, unknown> | null;
  return isString(fields?.input) && isString(fields.output);
};

const hasPropertiesShape = (
  value: Partial<Record<keyof ProblemProperties, unknown>> | null,
): boolean =>
  REQUIRED_TEXT_KEYS.every((key) => isString(value?.[key])) &&
  // Polygon omits some optional keys and writes null for others: a missing key and an explicit null are both fine.
  OPTIONAL_TEXT_KEYS.every((key) => isNullableString(value?.[key] ?? null)) &&
  Array.isArray(value?.sampleTests) &&
  value.sampleTests.every(isSampleTest);

/** problem-properties.json is untrusted: the shape is checked before any field is used. */
function parseProperties(json: string, path: string): ProblemProperties {
  let value: Partial<Record<keyof ProblemProperties, unknown>> | null;
  try {
    value = JSON.parse(json) as typeof value;
  } catch {
    throw new PolygonImportError(`${path} is not valid JSON`);
  }
  if (!hasPropertiesShape(value))
    throw new PolygonImportError(`${path} has an unexpected shape`);
  return value as unknown as ProblemProperties;
}

/** What `parseStatements` needs besides problem.xml: the package, the job's choices, and the two side-effecting converters. */
export interface StatementContext {
  pkg: PolygonPackage;
  job: PolygonImportJob;
  texToMarkdown: TexToMarkdown;
  saveImage: ImageSaver;
}
interface RenderedStatement {
  description: string;
  descriptionHtml: string;
}
type Translation = ImportedStatements['translations'][number];

async function readStatementSource(
  root: XmlElement,
  pkg: PolygonPackage,
  node: XmlElement,
  language: string,
): Promise<StatementSource> {
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
  return {
    language,
    name,
    folder,
    properties: parseProperties(
      await pkg.readText(propertiesPath, SOURCE_MAX_BYTES),
      propertiesPath,
    ),
  };
}

/** Every TeX statement of problem.xml with its properties, one per language. Each statement is fully checked before the next is read. */
async function readStatementSources(
  root: XmlElement,
  pkg: PolygonPackage,
): Promise<StatementSource[]> {
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
    sources.push(await readStatementSource(root, pkg, node, language));
  }
  return sources;
}

/** A single statement is the main one; with several, the job names it. Checked before anything is rendered, so a bad choice saves no image. */
function pickMainLanguage(
  sources: StatementSource[],
  job: PolygonImportJob,
): string {
  const mainLanguage =
    sources.length === 1 ? sources[0].language : job.mainStatementLanguage;
  if (
    !mainLanguage ||
    !sources.some((source) => source.language === mainLanguage)
  )
    throw new PolygonImportError(
      `invalid main statement language ${mainLanguage ?? '(none)'}`,
      'statement_language_required',
      { languages: sources.map((source) => source.language) },
    );
  return mainLanguage;
}

/** Saves the statement's images through `saveImage`, so it must run once per statement, in source order. */
async function renderSourceAndSaveImages(
  source: StatementSource,
  style: RenderStyle,
  { pkg, texToMarkdown, saveImage }: StatementContext,
): Promise<RenderedStatement> {
  const description = await rehostImages(
    await buildDescription(source.properties, texToMarkdown),
    source.folder,
    pkg,
    saveImage,
  );
  return {
    description,
    descriptionHtml: renderStatement(
      description,
      style,
      `statement ${source.language}`,
    ),
  };
}

/** A statement the job leaves out: not rendered, no images saved, its tutorial never the editorial. */
const isSkipped = (source: StatementSource, job: PolygonImportJob): boolean =>
  Object.hasOwn(job.statementLanguages, source.language) &&
  job.statementLanguages[source.language] === 'skip';

function toTranslation(
  source: StatementSource,
  rendered: RenderedStatement,
  job: PolygonImportJob,
  earlierTranslations: Translation[],
): Translation {
  /** Languages come from problem.xml: `constructor` or `__proto__` must not resolve through the prototype. */
  const choice = Object.hasOwn(job.statementLanguages, source.language)
    ? job.statementLanguages[source.language]
    : undefined;
  const siteLanguage = choice === 'skip' ? undefined : choice;
  if (!siteLanguage)
    throw new PolygonImportError(
      `invalid site language for ${source.language}`,
      'statement_language_unmapped',
      { language: source.language },
    );
  if (
    earlierTranslations.some(
      (translation) => translation.language === siteLanguage,
    )
  )
    throw new PolygonImportError(
      `two statements map to the site language ${siteLanguage}`,
      'statement_language_repeated',
      { language: siteLanguage },
    );
  return { language: siteLanguage, name: source.name, ...rendered };
}

/** The one tutorial, or the job's choice among several, as markdown with its images saved; '' when no statement has one. */
async function pickAndSaveTutorial(
  sources: StatementSource[],
  { job, pkg, texToMarkdown, saveImage }: StatementContext,
): Promise<string> {
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
      'tutorial_language_required',
      { languages: tutorials.map((source) => source.language) },
    );
  if (!tutorialSource) return '';
  return rehostImages(
    await texToMarkdown(tutorialSource.properties.tutorial!),
    tutorialSource.folder,
    pkg,
    saveImage,
  );
}

/** Legacy `parse_statements` in its non-interactive form: every choice comes from the job. The result passes the editor's statement limits. */
export async function parseStatements(
  root: XmlElement,
  context: StatementContext,
): Promise<ImportedStatements> {
  const sources = await readStatementSources(root, context.pkg);
  const mainLanguage = pickMainLanguage(sources, context.job);
  // Imported text is never trusted HTML, full-markup problem or not: TeX math holding `$` splits a formula and leaves raw HTML outside it.
  const style: RenderStyle = 'problem';
  context = {
    ...context,
    saveImage: withImageBudget(context.saveImage, IMPORT_IMAGES_MAX_BYTES),
  };
  const imported: ImportedStatements = {
    name: '',
    description: '',
    descriptionHtml: '',
    translations: [],
    tutorial: '',
  };
  const kept = sources.filter(
    (source) =>
      source.language === mainLanguage || !isSkipped(source, context.job),
  );
  for (const source of kept) {
    const rendered = await renderSourceAndSaveImages(source, style, context);
    if (source.language === mainLanguage)
      Object.assign(imported, { name: source.name, ...rendered });
    else
      imported.translations.push(
        toTranslation(source, rendered, context.job, imported.translations),
      );
  }
  imported.tutorial =
    context.job.importTutorial === false
      ? ''
      : await pickAndSaveTutorial(kept, context);
  return imported;
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
  const lead = tutorial.trimEnd();
  return `${lead ? `${lead}\n\n` : ''}<blockquote class="spoiler">\n${fence(code, language)}</blockquote>\n`;
}
