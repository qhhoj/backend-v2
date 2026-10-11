import { isLanguageActive, uuidStr } from '@libs/database';
import type { Language } from '@libs/database';

export class LanguageAdminResponse {
  /** Language id. */
  id!: string;
  /** Key judges report for the language. */
  key!: string;
  /** Display name. */
  name!: string;
  /** Short display name; null when none. */
  shortName!: string | null;
  /** Generic family name shared by versions. */
  commonName!: string;
  /** Editor mode name. */
  ace!: string;
  /** Syntax highlighter name. */
  pygments!: string;
  /** Starter code offered in the editor. */
  template!: string;
  /** Notes about the compiler or runtime. */
  info!: string;
  /** Longer description. */
  description!: string;
  /** File extension without the dot. */
  extension!: string;
  /** Whether solutions are uploaded as a file. */
  fileOnly!: boolean;
  /** Largest uploaded file in MB; 0 turns uploads off. */
  fileSizeLimit!: number;
  /** Whether new problems allow it by default. */
  includeInProblem!: boolean;
  /** false: hidden from the submit form, new submissions refused. */
  isActive!: boolean;
  /** Lists show languages by this, then name; lower first. */
  order!: number;

  static from(language: Language): LanguageAdminResponse {
    return {
      id: uuidStr(language._id),
      key: language.key,
      name: language.name,
      shortName: language.shortName,
      commonName: language.commonName,
      ace: language.ace,
      pygments: language.pygments,
      template: language.template,
      info: language.info,
      description: language.description,
      extension: language.extension,
      fileOnly: language.fileOnly,
      fileSizeLimit: language.fileSizeLimit,
      includeInProblem: language.includeInProblem,
      isActive: isLanguageActive(language),
      order: language.order ?? 0,
    };
  }
}

export class LanguageUsageResponse {
  /** Language id. */
  languageId!: string;
  /** Problems that allow it. */
  problems!: number;
  /** Submissions in it over the last 30 days. */
  recentSubmissions!: number;
}
