import { STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { IsIn, IsOptional } from 'class-validator';

export class StatementLangQueryDto {
  @IsOptional() @IsIn(STATEMENT_LANGUAGES) lang: StatementLanguage = 'en';
}
