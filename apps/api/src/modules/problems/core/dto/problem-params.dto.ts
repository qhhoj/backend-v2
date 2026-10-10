import { BASE_STATEMENT_LANGUAGE, STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class StatementLangQueryDto {
  /** Statement language; falls back to the base statement when no translation exists. */
  @ApiPropertyOptional({
    enum: STATEMENT_LANGUAGES,
    enumName: 'StatementLanguage',
  })
  @IsOptional()
  @IsIn(STATEMENT_LANGUAGES)
  lang: StatementLanguage = BASE_STATEMENT_LANGUAGE;
}

/** Unvalidated shape: a malformed code is a 404 (see `ProblemsService.visibleProblem`), never a 400. */
export class ProblemCodeParamDto {
  /** Problem code: lowercase letters, digits and underscores, 1 to 32 characters. */
  @IsString() code!: string;
}
