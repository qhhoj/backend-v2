import { Type } from 'class-transformer';
import { IsNumber, Min, ValidateNested } from 'class-validator';
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
