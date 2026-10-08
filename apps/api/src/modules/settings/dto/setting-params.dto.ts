import { IsString, IsUUID, Matches } from 'class-validator';

export class SettingKeyParamDto {
  @IsString() @Matches(/^[A-Za-z][A-Za-z.]{0,63}$/) key!: string;
}

export class SettingRevisionParamDto extends SettingKeyParamDto {
  @IsUUID('7') revisionId!: string;
}
