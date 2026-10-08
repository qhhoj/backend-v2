import { IsString, MaxLength } from 'class-validator';
import { MISC_CONFIG_VALUE_MAX } from '@libs/database';

export class PutMiscConfigDto {
  /** Public: served to everyone by `GET /site`. Never put a secret here. `''` is a valid value. */
  @IsString() @MaxLength(MISC_CONFIG_VALUE_MAX) value!: string;
}
