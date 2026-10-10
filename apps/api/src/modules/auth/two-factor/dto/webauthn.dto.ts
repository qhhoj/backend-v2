import { IsObject, IsString, Length } from 'class-validator';

export class WebauthnRegisterDto {
  /** Display name for the key, 1-100 characters. */
  @IsString() @Length(1, 100) name!: string;
  /**
   * The registration response object from `navigator.credentials.create`, serialized as JSON.
   */
  @IsObject() response!: Record<string, unknown>;
}

export class WebauthnLoginDto {
  /**
   * The assertion response object from `navigator.credentials.get`, serialized as JSON.
   */
  @IsObject() response!: Record<string, unknown>;
}
