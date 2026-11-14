import { familyOf, preparePascal } from './similarity-languages';

describe('similarity languages', () => {
  it('maps judge common names, ignoring case, onto engine families shared by their variants', () => {
    expect(familyOf('C++')?.name).toBe('cpp');
    expect(familyOf('c++')?.language).toBe('cpp');
    expect(familyOf('C')?.name).toBe('cpp');
    expect(familyOf('C')?.language).toBe('cpp');
    expect(familyOf('Python')?.name).toBe('python');
    expect(familyOf('PyPy')?.name).toBe('python');
    expect(familyOf('JS')?.language).toBe('javascript');
    expect(familyOf('C#')?.language).toBe('c-sharp');
    expect(familyOf('Java')?.tokenizer).toBe('syntax');
  });

  it('answers null for languages without a grammar', () => {
    for (const name of [
      'Kotlin',
      'Haskell',
      'Ruby',
      'Perl',
      'TEXT',
      'Output Only',
      'Scratch',
      '',
    ])
      expect(familyOf(name)).toBeNull();
  });

  it('compares Pascal as text after normalising it', () => {
    const pascal = familyOf('Pascal');
    expect(pascal).toMatchObject({
      name: 'pascal',
      tokenizer: 'text',
      language: 'char',
    });
    expect(pascal!.kgramLength).toBeGreaterThan(familyOf('C++')!.kgramLength);
  });

  it('strips Pascal comments and case but keeps every line number', () => {
    const source = 'Begin {note}\n  X  :=   1; // c\n(* multi\nline *)\nEnd.';
    const prepared = preparePascal(source);
    expect(prepared).toBe('begin\nx := 1;\n\n\nend.');
    expect(prepared.split('\n')).toHaveLength(source.split('\n').length);
  });

  it('prepares Pascal in time linear in its length when comment openers never close', () => {
    for (const opener of ['{', '(*']) {
      const line = `s:='${opener.repeat(100)}'; // c\n`;
      const source = line.repeat(Math.ceil((256 * 1024) / line.length));
      const startedAt = performance.now();
      const prepared = preparePascal(source);
      expect(performance.now() - startedAt).toBeLessThan(500);
      expect(prepared.split('\n')[0]).toBe(`s:='${opener.repeat(100)}';`);
      expect(prepared.split('\n')).toHaveLength(source.split('\n').length);
    }
  });
});
