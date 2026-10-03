import { Injectable } from '@nestjs/common';
import {
  CatalogItemResponse,
  LanguageResponse,
  LicenseResponse,
  ProblemMetaResponse,
} from './dto/problem-meta.response';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';

const byField =
  <Item>(field: keyof Item) =>
  (left: Item, right: Item) =>
    String(left[field]).localeCompare(String(right[field]));

@Injectable()
export class ProblemsService {
  constructor(
    private readonly types: ProblemTypesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    private readonly licenses: LicensesQuerier,
    private readonly languages: LanguagesQuerier,
  ) {}

  meta(): ProblemMetaResponse {
    return {
      types: this.types
        .all()
        .sort(byField('fullName'))
        .map(CatalogItemResponse.from),
      groups: this.groups
        .all()
        .sort(byField('fullName'))
        .map(CatalogItemResponse.from),
      licenses: this.licenses
        .all()
        .sort(byField('name'))
        .map(LicenseResponse.from),
      languages: this.languages
        .all()
        .sort(byField('name'))
        .map(LanguageResponse.from),
    };
  }
}
