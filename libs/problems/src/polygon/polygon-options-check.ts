import type { StatementLanguageChoice } from '@libs/database';
import type {
  ImportErrorParams,
  PolygonImportErrorCode,
} from './polygon-import-errors';

/** The statement options of an import or a link. */
export interface StatementOptions {
  mainStatementLanguage: string | null;
  statementLanguages: Record<string, StatementLanguageChoice>;
  tutorialLanguage: string | null;
}

/** A choice the worker would refuse, with the worker's code and text. */
export interface OptionsRefusal {
  code: PolygonImportErrorCode;
  params: ImportErrorParams;
  message: string;
}

const choiceOf = (options: StatementOptions, language: string) =>
  Object.hasOwn(options.statementLanguages, language)
    ? options.statementLanguages[language]
    : undefined;

/** The main language: the only statement's, else the one the options name, if Polygon has it. */
function mainLanguageOf(
  languages: string[],
  options: StatementOptions,
): string | null {
  const main =
    languages.length === 1 ? languages[0] : options.mainStatementLanguage;
  return main && languages.includes(main) ? main : null;
}

/** Each other statement needs a site language or `skip`, and two may not share one. */
function translationRefusal(
  others: string[],
  options: StatementOptions,
): OptionsRefusal | null {
  const taken = new Set<string>();
  for (const language of others) {
    const choice = choiceOf(options, language);
    if (!choice)
      return {
        code: 'statement_language_unmapped',
        params: { language },
        message: `invalid site language for ${language}`,
      };
    if (choice !== 'skip' && taken.has(choice))
      return {
        code: 'statement_language_repeated',
        params: { language: choice },
        message: `two statements map to the site language ${choice}`,
      };
    taken.add(choice);
  }
  return null;
}

/**
 * The worker's statement checks (`parseStatements`), made on what `problem.statements` lists before anything is
 * queued or downloaded: same codes, same order. Null when the options fit, or when Polygon lists no statement (the
 * worker reports that one itself).
 */
export function statementOptionsRefusal(
  statements: Array<{ language: string; hasTutorial: boolean }>,
  options: StatementOptions,
): OptionsRefusal | null {
  const languages = statements.map(({ language }) => language);
  if (!languages.length) return null;
  const main = mainLanguageOf(languages, options);
  if (!main)
    return {
      code: 'statement_language_required',
      params: { languages },
      message: `invalid main statement language ${options.mainStatementLanguage ?? '(none)'}`,
    };
  const others = languages.filter((language) => language !== main);
  const refusal = translationRefusal(others, options);
  if (refusal) return refusal;
  const tutorials = statements
    .filter(
      ({ language, hasTutorial }) =>
        hasTutorial &&
        (language === main || choiceOf(options, language) !== 'skip'),
    )
    .map(({ language }) => language);
  if (
    tutorials.length > 1 &&
    !tutorials.includes(options.tutorialLanguage ?? '')
  )
    return {
      code: 'tutorial_language_required',
      params: { languages: tutorials },
      message: `invalid main tutorial language ${options.tutorialLanguage ?? '(none)'}`,
    };
  return null;
}

/** The worker refuses a testset larger than the testcase limit; Polygon lists the tests before the package is downloaded. */
export function testCountRefusal(
  count: number,
  maxCases: number,
): OptionsRefusal | null {
  return count > maxCases
    ? {
        code: 'too_many_testcases',
        params: { count, limit: maxCases },
        message: `too many testcases: ${count}, the limit is ${maxCases}`,
      }
    : null;
}
