import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';
import { ANY_JSON_VALUE } from './any-json-value';

export class UpdateSettingDto {
  /** The new value (merged into the stored one for object settings such as `auth.google`). */
  @ApiProperty(ANY_JSON_VALUE)
  @IsDefined()
  value!: unknown;
}
