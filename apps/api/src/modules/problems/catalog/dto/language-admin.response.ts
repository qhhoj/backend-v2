import { uuidStr } from '@libs/database';
import type { Language } from '@libs/database';

export class LanguageAdminResponse {
  id!: string;
  key!: string;
  name!: string;
  shortName!: string | null;
  commonName!: string;
  ace!: string;
  pygments!: string;
  template!: string;
  info!: string;
  description!: string;
  extension!: string;
  fileOnly!: boolean;
  fileSizeLimit!: number;
  includeInProblem!: boolean;

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
    };
  }
}
