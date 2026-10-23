import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { LANGUAGE_PAIR } from '../../imports/statement-language-pairs';

/** Every field is optional and an omitted one keeps its value; the options apply from the next sync (the one running keeps its own). */
export class UpdatePolygonLinkDto {
  /** Check Polygon every 10 minutes and sync a newer READY package. */
  @IsOptional() @IsBoolean() autoSync?: boolean;
  /** Polygon language of the statement stored as the base statement; null lets a single-statement package decide. */
  @IsOptional() @IsString() @MaxLength(30) mainStatementLanguage?:
    string | null;
  /** The whole mapping `<polygon language>=<en|vi|skip>`, as the import takes it; replaces the saved one. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(LANGUAGE_PAIR, { each: true })
  statementLanguages?: string[];
  /** Polygon language of the tutorial imported as the editorial; null for none or a single tutorial. */
  @IsOptional() @IsString() @MaxLength(30) tutorialLanguage?: string | null;
  @IsOptional() @IsBoolean() ignoreZeroPointBatches?: boolean;
  @IsOptional() @IsBoolean() ignoreZeroPointCases?: boolean;
  @IsOptional() @IsBoolean() appendMainSolution?: boolean;
  @IsOptional() @IsBoolean() importTutorial?: boolean;
}

/** The body is optional: a sync without one keeps the local edits. */
export class SyncPolygonProblemDto {
  /** Replace the time and memory limits, partial scoring, checker and grader settings edited on QHHOJ since the last import with the package's values; by default they are kept. */
  @IsOptional() @IsBoolean() overwriteLocalEdits?: boolean;
}
