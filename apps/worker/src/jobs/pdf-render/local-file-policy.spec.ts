import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAllowedRequest } from './local-file-policy';

describe('isAllowedRequest', () => {
  const base = mkdtempSync(join(tmpdir(), 'qhhoj-policy-'));
  const allowed = join(base, 'allowed');
  const secret = join(base, 'secret.txt');
  const page = join(base, 'page.html');
  const urlOf = (path: string) => pathToFileURL(path).href;
  beforeAll(() => {
    mkdirSync(allowed);
    writeFileSync(join(allowed, 'ok.png'), 'x');
    writeFileSync(secret, 'x');
    writeFileSync(page, 'x');
    symlinkSync(secret, join(allowed, 'link.png'));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('allows files inside an allowed directory and the exact allowed file', async () => {
    const roots = [allowed, page];
    expect(await isAllowedRequest(urlOf(join(allowed, 'ok.png')), roots)).toBe(
      true,
    );
    expect(await isAllowedRequest(urlOf(page), roots)).toBe(true);
  });
  it.each([
    ['a sibling file', () => urlOf(secret)],
    ['a dot-dot escape', () => `${urlOf(allowed)}/../secret.txt`],
    ['an encoded dot-dot escape', () => `${urlOf(allowed)}/%2e%2e/secret.txt`],
    ['a symlink leaving the directory', () => urlOf(join(allowed, 'link.png'))],
    ['a missing file', () => urlOf(join(allowed, 'missing.png'))],
    ['a directory prefix collision', () => urlOf(`${allowed}-other/x`)],
    ['http', () => 'http://127.0.0.1/x.png'],
    ['https', () => 'https://example.test/x.png'],
    ['data urls', () => 'data:image/png;base64,AAAA'],
    ['a malformed url', () => 'not a url'],
  ])('rejects %s', async (_label, url) => {
    expect(await isAllowedRequest(url(), [allowed, page])).toBe(false);
  });
});
