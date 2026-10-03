import { GIF, JPG, PDF, PNG, SVG } from '../../../test/sample-files';
import { isPdf, sniffImage } from './file-sniff';

describe('file sniffing', () => {
  it.each([
    ['png', PNG],
    ['jpg', JPG],
    ['gif', GIF],
    ['svg', SVG],
  ])('detects %s', (kind, content) => expect(sniffImage(content)).toBe(kind));
  it.each([
    Buffer.from('hello'),
    PDF,
    Buffer.from('<html><svg></svg></html>'),
    Buffer.alloc(0),
  ])('rejects non-images', (content) => expect(sniffImage(content)).toBeNull());
  it('detects pdf', () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(PNG)).toBe(false);
  });
});
