import { IsObject, IsString, Length } from 'class-validator';

export class WebauthnRegisterDto {
  @IsString() @Length(1, 100) name!: string;
  @IsObject() response!: Record<string, unknown>;
}

export class WebauthnLoginDto {
  @IsObject() response!: Record<string, unknown>;
}
