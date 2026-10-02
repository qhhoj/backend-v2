import { IsString, Length } from 'class-validator';

export class TokenDto {
  @IsString() @Length(1, 512) token!: string;
}
