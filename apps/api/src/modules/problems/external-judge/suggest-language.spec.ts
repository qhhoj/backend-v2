import { suggestLanguage } from './suggest-language';

const language = (
  _id: string,
  key: string,
  name: string,
  commonName: string,
) => ({ _id, key, name, commonName, shortName: null });

const SITE = [
  language('cpp17', 'CPP17', 'C++17', 'C++'),
  language('cpp20', 'CPP20', 'C++20', 'C++'),
  language('py3', 'PY3', 'Python 3', 'Python'),
  language('pas', 'PAS', 'Pascal', 'Pascal'),
  language('java8', 'JAVA8', 'Java 8', 'Java'),
  language('c11', 'C11', 'C11', 'C'),
];

describe('suggestLanguage', () => {
  it.each([
    ['GNU G++20 13.2 (64 bit, winlibs)', 'cpp20'],
    ['C++17', 'cpp17'],
    ['Python 3', 'py3'],
    ['Free Pascal 3.2.2', 'pas'],
    ['Java 8', 'java8'],
  ])('maps %s to the site language %s', (remote, expected) => {
    expect(suggestLanguage(remote, SITE)).toBe(expected);
  });

  it('prefers an exact name over a looser one', () => {
    expect(suggestLanguage('G++17', SITE)).toBe('cpp17');
    expect(suggestLanguage('G++17', [...SITE].reverse())).toBe('cpp17');
  });

  it('answers null when nothing is close', () => {
    expect(suggestLanguage('Brainfuck', SITE)).toBeNull();
    expect(suggestLanguage('Haskell 9.4', SITE)).toBeNull();
    expect(suggestLanguage('Python 3', [])).toBeNull();
  });

  it('does not match a one-letter language inside any name', () => {
    expect(suggestLanguage('Free Pascal', [language('c', 'C', 'C', 'C')])).toBe(
      null,
    );
  });
});
