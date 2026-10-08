import { IsDefined } from 'class-validator';

export class UpdateSettingDto {
  /** The new value (merged into the stored one for object settings such as `auth.google`). */
  @IsDefined() value!: unknown;
}
