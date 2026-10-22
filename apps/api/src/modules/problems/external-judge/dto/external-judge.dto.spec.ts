import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ExternalJudgeVerifyDto,
  PutExternalJudgeDto,
} from './external-judge.dto';

const BODY = {
  isActive: true,
  oj: 'CodeForces',
  problemId: '490B',
  languages: [],
};

const failedFields = async (
  type: new () => object,
  fields: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(type, { ...BODY, ...fields }))).map(
    (error) => error.property,
  );

describe('external judge link validation', () => {
  it.each([PutExternalJudgeDto, ExternalJudgeVerifyDto])(
    'refuses a dot segment as the OJ or problem id on %p',
    async (type) => {
      expect(await failedFields(type, {})).toEqual([]);
      expect(await failedFields(type, { oj: '..', problemId: 'me' })).toEqual([
        'oj',
      ]);
      expect(await failedFields(type, { problemId: '.' })).toEqual([
        'problemId',
      ]);
      expect(await failedFields(type, { problemId: 'a..b' })).toEqual([]);
    },
  );
});
