import mongoose from 'mongoose';
import { LanguageSchema } from './language.schema';

describe('Language schema', () => {
  const Languages = mongoose.model('LanguageSchemaSpec', LanguageSchema);
  const language = (extension: string) =>
    new Languages({
      key: 'SCRATCH',
      name: 'Scratch',
      commonName: 'Scratch',
      ace: 'text',
      pygments: 'text',
      extension,
    });

  it('takes a lowercase alphanumeric extension of 1 to 10 characters', () => {
    for (const extension of ['sb3', 'cpp', 'a', 'x'.repeat(10)])
      expect(language(extension).validateSync()).toBeUndefined();
  });

  it('refuses an extension that could change the path or how media is served', () => {
    for (const extension of [
      '',
      'HTML',
      'tar.gz',
      '../x',
      'a/b',
      'x'.repeat(11),
    ])
      expect(language(extension).validateSync()?.errors).toHaveProperty(
        'extension',
      );
  });
});
