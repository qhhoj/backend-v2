import { AppError } from '../errors/app.error';
import { RefuseNullFieldsPipe } from './refuse-null-fields.pipe';

describe('RefuseNullFieldsPipe', () => {
  const pipe = new RefuseNullFieldsPipe(['slots']);

  it('lets absent fields, values and listed nullable fields through', () => {
    const body = { name: 'x', slots: null };
    expect(pipe.transform(body)).toBe(body);
    expect(pipe.transform({})).toEqual({});
  });

  it('names every other null field in a 400', () => {
    try {
      pipe.transform({ slug: null, about: null, slots: null, name: 'x' });
      fail('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).fields).toEqual({
        slug: ['Must not be null.'],
        about: ['Must not be null.'],
      });
    }
  });
});
