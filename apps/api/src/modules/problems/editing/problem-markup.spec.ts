import { AppError } from '@libs/common';
import { renderField } from './problem-markup';

describe('renderField', () => {
  // 2000 formulas and 68k empty headings: small input, past the 2 MiB rendered-HTML cap.
  const OVER_TWO_MIB = `${`$${'x'.repeat(28)}$ `.repeat(2000)}\n\n${'#\n'.repeat(68000)}`;

  it.each(['problem', 'problem-full'] as const)(
    'reports markdown that renders past 2 MiB (%s) as validation_failed on the field',
    (style) => {
      let thrown: unknown;
      try {
        renderField(OVER_TWO_MIB, style, 'description');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({ code: 'validation_failed', status: 400 });
      expect(Object.keys((thrown as AppError).fields!)).toEqual([
        'description',
      ]);
    },
  );
});
