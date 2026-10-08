export type SimilarityTokenizer = 'syntax' | 'text';

export interface SimilarityFamily {
  /** Stored on the run's groups and pairs; one family covers every judge language that maps to it. */
  name: string;
  /** Dolos language the engine tokenizes with (`char` is its character tokenizer). */
  language: string;
  tokenizer: SimilarityTokenizer;
  kgramLength: number;
  kgramsInWindow: number;
  /** Applied to every source before it is sent; must keep the number of lines. */
  prepare(source: string): string;
}

const syntax = (language: string): SimilarityFamily => ({
  name: language,
  language,
  tokenizer: 'syntax',
  kgramLength: 23,
  kgramsInWindow: 17,
  prepare: (source) => source,
});

/**
 * Comments (`{ }`, `(* *)`, `//`) become nothing but keep their newlines; case and runs of blanks do not matter in Pascal.
 * Braces inside string literals are eaten as comments too: that only lowers similarity, it never fails.
 */
export const preparePascal = (source: string): string =>
  source
    .replace(/\{[\s\S]*?\}|\(\*[\s\S]*?\*\)|\/\/[^\n]*/g, (comment) =>
      comment.replace(/[^\n]/g, ''),
    )
    .toLowerCase()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n');

/** Dolos bundles no Pascal grammar: characters are the tokens, so a copy with renamed identifiers scores lower than in the syntax families. */
const PASCAL: SimilarityFamily = {
  name: 'pascal',
  language: 'char',
  tokenizer: 'text',
  kgramLength: 40,
  kgramsInWindow: 17,
  prepare: preparePascal,
};

/** C is parsed with the C++ grammar so C pasted as C++ (and back) is still found: the two form one family. */
const C_AND_CPP = syntax('cpp');

const PYTHON = syntax('python');
const JAVASCRIPT = syntax('javascript');

/** Keyed by lower-cased `Language.commonName` (legacy catalog: C, C++, Pascal, Python, PyPy, Java, Kotlin, PHP, C#, Go, OCaml, JS, ...). Anything absent has no grammar and is skipped and listed in the run summary. */
const FAMILIES = new Map<string, SimilarityFamily>([
  ['c', C_AND_CPP],
  ['c++', C_AND_CPP],
  ['java', syntax('java')],
  ['python', PYTHON],
  ['pypy', PYTHON],
  ['js', JAVASCRIPT],
  ['javascript', JAVASCRIPT],
  ['c#', syntax('c-sharp')],
  ['go', syntax('go')],
  ['rust', syntax('rust')],
  ['php', syntax('php')],
  ['ocaml', syntax('ocaml')],
  ['scala', syntax('scala')],
  ['pascal', PASCAL],
]);

export const familyOf = (commonName: string): SimilarityFamily | null =>
  FAMILIES.get(commonName.toLowerCase()) ?? null;
