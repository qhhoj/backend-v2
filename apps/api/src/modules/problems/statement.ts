import { Problem, StatementLanguage } from '@libs/database';

export const BASE_LANGUAGE: StatementLanguage = 'en';

export interface Statement {
  language: StatementLanguage;
  name: string;
  description: string;
  descriptionHtml: string;
  translated: boolean;
}

/** The statement in `lang`, or the base statement (English on QHHOJ) when no such translation exists. */
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
  return translation
    ? {
        language: lang,
        name: translation.name,
        description: translation.description,
        descriptionHtml: translation.descriptionHtml,
        translated: true,
      }
    : {
        language: BASE_LANGUAGE,
        name: problem.name,
        description: problem.description,
        descriptionHtml: problem.descriptionHtml,
        translated: false,
      };
}
