import {
  ArrayMaxSize,
  ArrayMinSize,
  IsString,
  MaxLength,
} from 'class-validator';

export class AssignTagsDto {
  /** Codes of the tags to add (from `GET /tags/catalog`), 1 to 50. */
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tagCodes!: string[];
}
