import { IsString, Length } from 'class-validator';

export class TokenDto {
  /** The key from the activation link. */
  @IsString() @Length(1, 512) token!: string;
}
