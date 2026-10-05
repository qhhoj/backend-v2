import { extensionOf, safeFileName } from './file-names';

describe('safeFileName', () => {
  it.each([
    ['b\\..\\c.zip', 'b.c.zip'],
    ['../../etc/passwd', 'passwd'],
    ['my file (final).zip', 'my_file_final.zip'],
    ['.hidden', 'hidden'],
    ['..', 'material'],
    ['a\0b.txt', 'ab.txt'],
  ])('turns %j into %j', (name, expected) =>
    expect(safeFileName(name)).toBe(expected),
  );
  it('only ever yields allow-listed characters, no "..", no leading dot, capped', () => {
    const name = safeFileName(`..${'x/\\..y'.repeat(60)}%2e%2e/é☃.zip`);
    expect(name).toMatch(/^[\w-][\w.-]{0,99}$/);
    expect(name).not.toContain('..');
  });
});

describe('extensionOf', () => {
  it.each([
    ['a.CPP', 'cpp'],
    ['x.tar.gz', 'gz'],
    ['cpp', ''],
    ['.cpp', ''],
    ['', ''],
  ])('%s -> "%s"', (name, expected) =>
    expect(extensionOf(name)).toBe(expected),
  );
});
