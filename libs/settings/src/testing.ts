import { SETTINGS } from './registry';
import type { SettingKey, SettingValue } from './registry';

type Overrides = { [Key in SettingKey]?: SettingValue<Key> };

/** A stand-in for `SettingsService` in unit specs: `get` answers an override or the registry default. */
export class FakeSettings {
  constructor(private overrides: Overrides = {}) {}
  get<Key extends SettingKey>(key: Key): SettingValue<Key> {
    return (
      key in this.overrides ? this.overrides[key] : SETTINGS[key].default
    ) as SettingValue<Key>;
  }
  override<Key extends SettingKey>(key: Key, value: SettingValue<Key>): void {
    this.overrides = { ...this.overrides, [key]: value };
  }
}
export const fakeSettings = (overrides: Overrides = {}) =>
  new FakeSettings(overrides);
