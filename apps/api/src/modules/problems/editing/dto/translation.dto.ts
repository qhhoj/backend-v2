import { STATEMENT_LANGUAGES } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, Length, MaxLength } from 'class-validator';
import { ProblemCodeParamDto } from '../../core/dto/problem-params.dto';
import { IsStatementText } from '../../core/dto/statement-text';
import { MAX_MARKDOWN_LENGTH } from '../../core/dto/limits';

export class TranslationParamsDto extends ProblemCodeParamDto {
  /** Language of the translation. */
  @ApiProperty({ enum: STATEMENT_LANGUAGES, enumName: 'StatementLanguage' })
  @IsIn(STATEMENT_LANGUAGES)
  lang!: StatementLanguage;
}

export class PutTranslationDto {
  /** Translated title, 1 to 100 characters. */
  @IsStatementText() @Length(1, 100) name!: string;
  /** Translated statement in markdown. */
  @IsStatementText() @MaxLength(MAX_MARKDOWN_LENGTH) description!: string;
}
