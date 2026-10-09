import { STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class StatementLangQueryDto {
  @ApiPropertyOptional({
    enum: STATEMENT_LANGUAGES,
    enumName: 'StatementLanguage',
  })
  @IsOptional()
  @IsIn(STATEMENT_LANGUAGES)
  lang: StatementLanguage = 'en';
}

/** Unvalidated shape: a malformed code is a 404 (see `ProblemsService.visibleProblem`), never a 400. */
export class ProblemCodeParamDto {
  @IsString() code!: string;
}
