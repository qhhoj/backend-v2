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
  it('serves the base statement as Vietnamese, in the requested language', () => {
    expect(statementFor(problem, 'vi')).toMatchObject({
      language: 'vi',
      name: 'Tổng',
      translated: true,
    });
  });

  it('falls back to the Vietnamese base for English without a translation', () => {
    expect(statementFor(problem, 'en')).toMatchObject({
      language: 'vi',
      name: 'Tổng',
      translated: false,
    });
  });

  it('serves the English translation when it exists', () => {
    expect(
      statementFor({ ...problem, translations: [english] }, 'en'),
    ).toMatchObject({ language: 'en', name: 'Sum', translated: true });
  });

  it('keeps serving the base for Vietnamese when only English is translated', () => {
    expect(
      statementFor({ ...problem, translations: [english] }, 'vi'),
    ).toMatchObject({ language: 'vi', name: 'Tổng', translated: true });
  });
});
