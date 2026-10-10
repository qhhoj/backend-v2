import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CloneProblemDto } from './clone.dto';
import { CreateProblemDto, UpdateProblemDto } from './problem-edit.dto';
import { PolygonImportQueryDto } from '../../imports/dto/problem-import.dto';

const codeErrors = async (
  type: new () => object,
  code: string,
): Promise<string[]> =>
  (await validate(plainToInstance(type, { code })))
    .filter((error) => error.property === 'code')
    .flatMap((error) => Object.keys(error.constraints ?? {}));

describe('problem code validation', () => {
  it.each([CreateProblemDto, CloneProblemDto])(
    'refuses the codes that static routes own on %p',
    async (type) => {
      for (const code of ['deleted', 'meta', 'imports', 'random'])
        expect(await codeErrors(type, code)).toContain('isNotIn');
    },
  );

  it('refuses the same codes on a rename (UpdateProblemDto) and on a Polygon import', async () => {
    for (const type of [UpdateProblemDto, PolygonImportQueryDto])
      for (const code of ['deleted', 'meta', 'imports', 'random'])
        expect(await codeErrors(type, code)).toContain('isNotIn');
  });

  it('accepts an ordinary code', async () => {
    for (const type of [
      CreateProblemDto,
      UpdateProblemDto,
      CloneProblemDto,
      PolygonImportQueryDto,
    ])
      expect(await codeErrors(type, 'sum_of_two')).toEqual([]);
  });
});
