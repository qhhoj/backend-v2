import type { Language, License } from '@libs/database';

export class CatalogItemResponse {
  /** Catalog item id. */
  id!: string;
  /** Short name. */
  name!: string;
  /** Full display name. */
  fullName!: string;

  static from(item: {
    _id: string;
    name: string;
    fullName: string;
  }): CatalogItemResponse {
    return { id: item._id, name: item.name, fullName: item.fullName };
  }
}

export class LicenseResponse {
  /** License id. */
  id!: string;
  /** Unique key. */
  key!: string;
  /** License name. */
  name!: string;
  /** URL of the license text. */
  link!: string;
  /** Text shown beside problems under this license. */
  display!: string;
  /** URL of the license icon. */
  icon!: string;

  static from(license: License): LicenseResponse {
    return {
      id: license._id,
      key: license.key,
      name: license.name,
      link: license.link,
      display: license.display,
      icon: license.icon,
    };
  }
}

export class LanguageResponse {
  /** Language id. */
  id!: string;
  /** Key judges report for the language. */
  key!: string;
  /** Display name. */
  name!: string;
  /** Short display name; null when none. */
  shortName!: string | null;
  /** Generic family name, shared by versions. */
  commonName!: string;
  /** Editor mode name for the code editor. */
  ace!: string;
  /** File extension without the dot. */
  extension!: string;
  /** Starter code offered in the editor. */
  template!: string;
  /** Whether solutions are uploaded as a file instead of typed. */
  fileOnly!: boolean;
  /** Largest uploaded file in MB; 0 turns uploads off. */
  fileSizeLimit!: number;
  /** Whether new problems allow this language by default. */
  includeInProblem!: boolean;

  static from(language: Language): LanguageResponse {
    const {
      _id: id,
      key,
      name,
      shortName,
      commonName,
      ace,
      extension,
      template,
      fileOnly,
      fileSizeLimit,
      includeInProblem,
    } = language;
    return {
      id,
      key,
      name,
      shortName,
      commonName,
      ace,
      extension,
      template,
      fileOnly,
      fileSizeLimit,
      includeInProblem,
    };
  }
}

export class ProblemMetaResponse {
  /** Problem types. */
  types!: CatalogItemResponse[];
  /** Problem groups. */
  groups!: CatalogItemResponse[];
  /** Licenses a problem can use. */
  licenses!: LicenseResponse[];
  /** Judge languages. */
  languages!: LanguageResponse[];
}
