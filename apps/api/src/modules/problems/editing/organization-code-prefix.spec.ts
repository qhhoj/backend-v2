import { assertOrganizationCodePrefix } from './organization-code-prefix';

const issueOf = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return (error as { extra?: { issues?: { code: string }[] } }).extra
      ?.issues?.[0]?.code;
  }
  return null;
};

describe('assertOrganizationCodePrefix', () => {
  const person = { isSuperuser: false };

  it.each([
    ['thptdemo_bai1', null],
    ['thptdemo_', 'organization_code_prefix'],
    ['bai1', 'organization_code_prefix'],
    ['otherorg_bai1', 'organization_code_prefix'],
    ['xthptdemo_bai1', 'organization_code_prefix'],
  ])('%s → %s', (code, expected) =>
    expect(
      issueOf(() => assertOrganizationCodePrefix(person, code, 'thptdemo_')),
    ).toBe(expected),
  );

  it('lets a superuser choose any code', () =>
    expect(
      issueOf(() =>
        assertOrganizationCodePrefix(
          { isSuperuser: true },
          'bai1',
          'thptdemo_',
        ),
      ),
    ).toBeNull());
});
