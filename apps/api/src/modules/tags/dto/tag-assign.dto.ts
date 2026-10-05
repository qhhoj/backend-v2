import {
  ArrayMaxSize,
  ArrayMinSize,
  IsString,
  MaxLength,
} from 'class-validator';

export class AssignTagsDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tagCodes!: string[];
}
