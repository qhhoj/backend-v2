import { IsString, Length } from 'class-validator';

export class CodeDto {
  @IsString() @Length(6, 16) code!: string;
}
