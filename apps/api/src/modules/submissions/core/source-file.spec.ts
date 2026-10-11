import { sourceFilename } from './source-file';

describe('sourceFilename', () => {
  it('names the file after the submission id and the language extension', () => {
    expect(sourceFilename('0192-abc', 'cpp')).toBe('0192-abc.cpp');
    expect(sourceFilename('0192-abc', 'py')).toBe('0192-abc.py');
  });

  it('names Java files Main.java, the class every submission declares', () => {
    expect(sourceFilename('0192-abc', 'java')).toBe('Main.java');
  });

  it('falls back to .txt when the language has no extension', () => {
    expect(sourceFilename('0192-abc', '')).toBe('0192-abc.txt');
    expect(sourceFilename('0192-abc')).toBe('0192-abc.txt');
  });
});
