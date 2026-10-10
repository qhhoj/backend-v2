import {
  BASE_STATEMENT_LANGUAGE,
  Problem,
  StatementLanguage,
} from '@libs/database';

export interface Statement {
  language: StatementLanguage;
  name: string;
  description: string;
  descriptionHtml: string;
  /** True when the statement is in the requested language: the base language itself, or an existing translation. False means the request fell back to the base statement. */
  translated: boolean;
}

/** The statement in `lang`: its translation if one exists (a base-language translation overrides the base text), else the base statement (Vietnamese on QHHOJ), which is itself the requested language when `lang` is the base. */
export function statementFor(
  problem: Pick<
    Problem,
    'name' | 'description' | 'descriptionHtml' | 'translations'
  >,
  lang: StatementLanguage,
): Statement {
  const translation = problem.translations.find(
    (candidate) => candidate.language === lang,
  );
  if (translation)
    return {
      language: lang,
      name: translation.name,
      description: translation.description,
      descriptionHtml: translation.descriptionHtml,
      translated: true,
    };
  return {
    language: BASE_STATEMENT_LANGUAGE,
    name: problem.name,
    description: problem.description,
    descriptionHtml: problem.descriptionHtml,
    translated: lang === BASE_STATEMENT_LANGUAGE,
  };
}
