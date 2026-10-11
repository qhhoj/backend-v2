import { statementFor } from './statement';

const problem = {
  name: 'Tổng',
  description: 'Cộng $a+b$',
  descriptionHtml: '<p>Cộng</p>',
  translations: [] as {
    language: 'en' | 'vi';
    name: string;
    description: string;
    descriptionHtml: string;
  }[],
};
const english = {
  language: 'en' as const,
  name: 'Sum',
  description: 'Add',
  descriptionHtml: '<p>Add</p>',
};

describe('statementFor', () => {
  const withEnglish = { ...problem, translations: [english] };
  it.each([
    ['base as Vietnamese', problem, 'vi', ['vi', 'Tổng', true]],
    [
      'Vietnamese fallback for untranslated English',
      problem,
      'en',
      ['vi', 'Tổng', false],
    ],
    [
      'English translation when it exists',
      withEnglish,
      'en',
      ['en', 'Sum', true],
    ],
    [
      'base for Vietnamese when only English is translated',
      withEnglish,
      'vi',
      ['vi', 'Tổng', true],
    ],
  ] as const)('%s', (_label, source, asked, [language, name, translated]) => {
    expect(statementFor(source, asked)).toMatchObject({
      language,
      name,
      translated,
    });
  });
});
