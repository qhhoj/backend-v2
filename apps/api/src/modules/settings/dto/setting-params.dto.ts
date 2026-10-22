import { LowercaseUuid } from '@libs/common';
import { IsString, IsUUID, Matches } from 'class-validator';

export class SettingKeyParamDto {
  /** Setting key, for example `auth.google`. */
  @IsString() @Matches(/^[A-Za-z][A-Za-z.]{0,63}$/) key!: string;
}

export class SettingRevisionParamDto extends SettingKeyParamDto {
  /** Id of the revision, from the revision list. */
  @LowercaseUuid() @IsUUID('7') revisionId!: string;
}
