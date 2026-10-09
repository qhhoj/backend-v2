import { IsBoolean, IsOptional } from 'class-validator';

/** No initializer, so the plugin infers the optional booleans (R2 needs no annotation here). */
export class PublishProblemsDto {
  /** Also release the editorials; default false. */
  @IsOptional() @IsBoolean() editorials?: boolean;
  /** Report what would happen and write nothing; default false. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
