import { Language, License } from '@libs/database';

export class CatalogItemResponse {
  id!: string;
  name!: string;
  fullName!: string;

  static from(
    this: void,
    item: {
      _id: string;
      name: string;
      fullName: string;
    },
  ): CatalogItemResponse {
    return { id: item._id, name: item.name, fullName: item.fullName };
  }
}

export class LicenseResponse {
  id!: string;
  key!: string;
  name!: string;
  link!: string;
  display!: string;
  icon!: string;

  static from(this: void, license: License): LicenseResponse {
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
  id!: string;
  key!: string;
  name!: string;
  shortName!: string | null;
  commonName!: string;
  ace!: string;
  extension!: string;
  template!: string;
  fileOnly!: boolean;
  fileSizeLimit!: number;
  includeInProblem!: boolean;

  static from(this: void, language: Language): LanguageResponse {
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
  types!: CatalogItemResponse[];
  groups!: CatalogItemResponse[];
  licenses!: LicenseResponse[];
  languages!: LanguageResponse[];
}
