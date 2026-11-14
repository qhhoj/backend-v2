import { PASTE_MAX_BYTES, pasteSourceError } from './paste-source';

import type { FieldIssue } from '@libs/common';

const issueOf = (source: string): string[] =>
  (
    (pasteSourceError(source)?.extra?.issues as FieldIssue[] | undefined) ?? []
  ).map((issue) => issue.code);

describe('pasteSourceError', () => {
  it('caps the paste at 64 KB of UTF-8, counting bytes rather than characters', () => {
    expect(issueOf('a'.repeat(PASTE_MAX_BYTES))).toEqual([]);
    expect(issueOf('a'.repeat(PASTE_MAX_BYTES + 1))).toEqual([
      'source_too_large',
    ]);
    // 'ệ' is three bytes: under the cap in characters, over it in bytes.
    expect(issueOf('ệ'.repeat(PASTE_MAX_BYTES / 3 + 1))).toEqual([
      'source_too_large',
    ]);
  });

  it('refuses an empty paste and NUL bytes', () => {
    expect(issueOf(' \n')).toEqual(['source_empty']);
    expect(issueOf('int main() {}\0')).toEqual(['source_invalid']);
  });
});
