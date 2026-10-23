import {
  statementOptionsRefusal,
  testCountRefusal,
} from './polygon-options-check';
import type { StatementOptions } from './polygon-options-check';

const options = (overrides: Partial<StatementOptions> = {}) => ({
  mainStatementLanguage: null,
  statementLanguages: {},
  tutorialLanguage: null,
  ...overrides,
});
const statement = (language: string, hasTutorial = false) => ({
  language,
  hasTutorial,
});

describe('statementOptionsRefusal', () => {
  it('accepts a single statement without any option, and no statement at all', () => {
    expect(
      statementOptionsRefusal([statement('russian', true)], options()),
    ).toBeNull();
    expect(statementOptionsRefusal([], options())).toBeNull();
  });

  it('asks for a main language among those Polygon has, listing them', () => {
    const two = [statement('english'), statement('vietnamese')];
    for (const main of [null, 'french'])
      expect(
        statementOptionsRefusal(two, options({ mainStatementLanguage: main })),
      ).toMatchObject({
        code: 'statement_language_required',
        params: { languages: ['english', 'vietnamese'] },
      });
  });

  it('needs a site language or skip for every other statement, never one site language twice', () => {
    const three = [
      statement('english'),
      statement('russian'),
      statement('vietnamese'),
    ];
    const main = { mainStatementLanguage: 'english' };
    expect(
      statementOptionsRefusal(
        three,
        options({ ...main, statementLanguages: { vietnamese: 'vi' } }),
      ),
    ).toMatchObject({
      code: 'statement_language_unmapped',
      params: { language: 'russian' },
    });
    expect(
      statementOptionsRefusal(
        three,
        options({
          ...main,
          statementLanguages: { vietnamese: 'vi', russian: 'vi' },
        }),
      ),
    ).toMatchObject({
      code: 'statement_language_repeated',
      params: { language: 'vi' },
    });
    expect(
      statementOptionsRefusal(
        three,
        options({
          ...main,
          statementLanguages: { vietnamese: 'vi', russian: 'skip' },
        }),
      ),
    ).toBeNull();
  });

  it('asks for a tutorial language only among the tutorials of kept statements', () => {
    const tutorials = [
      statement('english', true),
      statement('russian', true),
      statement('vietnamese', true),
    ];
    const kept = options({
      mainStatementLanguage: 'english',
      statementLanguages: { vietnamese: 'vi', russian: 'skip' },
    });
    expect(statementOptionsRefusal(tutorials, kept)).toMatchObject({
      code: 'tutorial_language_required',
      params: { languages: ['english', 'vietnamese'] },
    });
    expect(
      statementOptionsRefusal(tutorials, {
        ...kept,
        tutorialLanguage: 'russian',
      }),
    ).toMatchObject({ code: 'tutorial_language_required' });
    // An old link has no `importTutorial`: it counts as true.
    expect(
      statementOptionsRefusal(tutorials, { ...kept, tutorialLanguage: null }),
    ).toMatchObject({ code: 'tutorial_language_required' });
    expect(
      statementOptionsRefusal(tutorials, {
        ...kept,
        tutorialLanguage: 'vietnamese',
      }),
    ).toBeNull();
  });
});

describe('testCountRefusal', () => {
  it('refuses more tests than the limit, naming both', () => {
    expect(testCountRefusal(300, 300)).toBeNull();
    expect(testCountRefusal(301, 300)).toEqual({
      code: 'too_many_testcases',
      params: { count: 301, limit: 300 },
      message: 'too many testcases: 301, the limit is 300',
    });
  });
});
