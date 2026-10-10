import { IsString, Length } from 'class-validator';

export class CodeDto {
  /** A 6-digit authenticator code, or a scratch code where the endpoint allows it. */
  @IsString() @Length(6, 16) code!: string;
}
