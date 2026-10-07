import { attachmentHeader } from './attachment-header';

describe('attachmentHeader', () => {
  it('keeps an ASCII name in both parameters', () => {
    expect(attachmentHeader('alice_1-data.zip')).toBe(
      `attachment; filename="alice_1-data.zip"; filename*=UTF-8''alice_1-data.zip`,
    );
  });

  it('replaces non-ASCII characters in the fallback and percent-encodes the real name', () => {
    expect(attachmentHeader('ngườidùng-data.zip')).toBe(
      `attachment; filename="ng__id_ng-data.zip"; filename*=UTF-8''ng%C6%B0%E1%BB%9Did%C3%B9ng-data.zip`,
    );
  });

  it('never lets a quote, space, line break or RFC 5987 delimiter into either parameter', () => {
    expect(attachmentHeader(`a"b c\r\n'(*)!-data.zip`)).toBe(
      `attachment; filename="a_b_c_______-data.zip"; filename*=UTF-8''a%22b%20c%0D%0A%27%28%2A%29%21-data.zip`,
    );
  });
});
