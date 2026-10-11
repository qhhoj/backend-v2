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
  it.each([
    CreateProblemDto,
    CloneProblemDto,
    UpdateProblemDto,
    PolygonImportQueryDto,
  ])(
    'refuses codes that static routes own on %p, accepts others',
    async (type) => {
      for (const code of ['deleted', 'meta', 'imports', 'random'])
        expect(await codeErrors(type, code)).toContain('isNotIn');
      expect(await codeErrors(type, 'sum_of_two')).toEqual([]);
    },
  );
});
