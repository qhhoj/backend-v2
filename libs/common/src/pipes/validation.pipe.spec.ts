import { Type } from 'class-transformer';
import {
  IsNumber,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { AppError } from '../errors/app.error';
import { validationPipe } from './validation.pipe';

class LimitDto {
  @IsNumber() @Min(1) timeLimit!: number;
}
class BodyDto {
  @ValidateNested({ each: true }) @Type(() => LimitDto) limits!: LimitDto[];
}

describe('validationPipe', () => {
  it('reports nested DTO errors under dotted field keys', async () => {
    const error: unknown = await validationPipe
      .transform(
        { limits: [{ timeLimit: 1 }, { timeLimit: 0 }] },
        { type: 'body', metatype: BodyDto },
      )
      .catch((thrown: unknown): unknown => thrown);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).fields).toEqual({
      'limits.1.timeLimit': ['timeLimit must not be less than 1'],
    });
  });
});

class NameDto {
  @IsString() @Length(2, 5) name!: string;
  @Matches(/^\w+$/, {
    message: 'Letters only.',
    context: { code: 'name_characters' },
  })
  slug!: string;
}

describe('validation issues', () => {
  it('names every failing constraint with a machine code next to the message', async () => {
    const error = (await validationPipe
      .transform({ name: 'x', slug: '??' }, { type: 'body', metatype: NameDto })
      .catch((caught: unknown) => caught)) as AppError;
    expect(error.code).toBe('validation_failed');
    expect(error.fields).toEqual({
      name: [expect.any(String) as unknown],
      slug: ['Letters only.'],
    });
    expect(error.extra?.issues).toEqual([
      {
        field: 'name',
        code: 'is_length',
        message: expect.any(String) as unknown,
      },
      { field: 'slug', code: 'name_characters', message: 'Letters only.' },
    ]);
  });
});
