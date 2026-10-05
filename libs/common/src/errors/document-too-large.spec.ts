import { isDocumentTooLarge } from './document-too-large';

describe('isDocumentTooLarge', () => {
  it.each([
    [{ code: 10334, message: 'BSONObj size: 17000000 is invalid' }],
    [new Error('Document is larger than the maximum size 16777216')],
  ])('recognises a size refusal', (error) => {
    expect(isDocumentTooLarge(error)).toBe(true);
  });

  it.each([[new Error('connection reset')], [{ code: 11000 }]])(
    'ignores other errors',
    (error) => {
      expect(isDocumentTooLarge(error)).toBe(false);
    },
  );
});
