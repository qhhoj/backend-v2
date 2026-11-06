import { LowercaseUuid } from '@libs/common';
import { SETTING_KEYS } from '@libs/settings';
import { IsIn, IsUUID } from 'class-validator';

export class SettingKeyParamDto {
  /** Setting key, for example `auth.google`. */
  @IsIn(SETTING_KEYS) key!: string;
}

export class SettingRevisionParamDto extends SettingKeyParamDto {
  /** Id of the revision, from the revision list. */
  @LowercaseUuid() @IsUUID('7') revisionId!: string;
}
