import { STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { IsIn, Length, MaxLength } from 'class-validator';
import { ProblemCodeParamDto } from './problem-params.dto';
import { IsStatementText } from './statement-text';
import { MAX_MARKDOWN_LENGTH } from './limits';

export class TranslationParamsDto extends ProblemCodeParamDto {
  @IsIn(STATEMENT_LANGUAGES) lang!: StatementLanguage;
}

export class PutTranslationDto {
  @IsStatementText() @Length(1, 100) name!: string;
  @IsStatementText() @MaxLength(MAX_MARKDOWN_LENGTH) description!: string;
}
