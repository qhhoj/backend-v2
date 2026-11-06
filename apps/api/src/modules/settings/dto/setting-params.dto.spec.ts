import { SETTING_KEYS } from '@libs/settings';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettingKeyParamDto } from './setting-params.dto';

const keyErrors = async (key: string) =>
  validate(plainToInstance(SettingKeyParamDto, { key }));

describe('setting key route parameter', () => {
  it('accepts every registry key and refuses others', async () => {
    for (const key of SETTING_KEYS) expect(await keyErrors(key)).toEqual([]);
    expect(await keyErrors('no.such.key')).not.toEqual([]);
  });
});
