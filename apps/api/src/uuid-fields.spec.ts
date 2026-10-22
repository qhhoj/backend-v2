import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';
import { KickDto } from './modules/organizations/membership/dto/kick.dto';
import { ProblemListQueryDto } from './modules/problems/core/dto/problem-list.dto';
import { UpdateProblemDto } from './modules/problems/editing/dto/problem-edit.dto';

const LOWER = '019a0000-0000-7000-8000-00000000abcd';
const UPPER = LOWER.toUpperCase();

type DtoClass = new () => object;

/** What the global validation pipe does: transform, then validate. */
const parse = async <T extends object>(cls: new () => T, body: object) => {
  const instance = plainToInstance(cls, body);
  return { instance, errors: await validate(instance) };
};

/** Every exported class of every `*.dto.ts` under this app. */
const dtoClasses = (): DtoClass[] =>
  readdirSync(__dirname, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.dto.ts'))
    .flatMap((file) =>
      Object.values(
        jest.requireActual<Record<string, unknown>>(join(__dirname, file)),
      ),
    )
    .filter((value): value is DtoClass => typeof value === 'function');

/** The `@IsUUID` properties of a class, with whether they hold an array. */
const uuidFields = (cls: DtoClass) =>
  getMetadataStorage()
    .getTargetValidationMetadatas(cls, '', true, false)
    .filter((rule) => rule.name === 'isUuid')
    .map((rule) => ({ property: rule.propertyName, each: !!rule.each }));

/** Whether an uppercase id (alone, or in an array for `each`) reads back lowercase. */
const lowercases = (
  cls: DtoClass,
  { property, each }: { property: string; each: boolean },
) => {
  const read = plainToInstance(cls, {
    [property]: each ? [UPPER] : UPPER,
  }) as Record<string, unknown>;
  return (
    JSON.stringify(read[property]) === JSON.stringify(each ? [LOWER] : LOWER)
  );
};

describe('UUID fields', () => {
  it('reads an uppercase user id as the lowercase one', async () => {
    const { instance, errors } = await parse(KickDto, { userId: UPPER });
    expect(errors).toEqual([]);
    expect(instance.userId).toBe(LOWER);
  });

  it('lowercases each id of a body array', async () => {
    const { instance, errors } = await parse(UpdateProblemDto, {
      organizations: [UPPER, LOWER],
    });
    expect(errors).toEqual([]);
    expect(instance.organizations).toEqual([LOWER, LOWER]);
  });

  it('lowercases a single repeatable query value into an array', async () => {
    const { instance, errors } = await parse(ProblemListQueryDto, {
      typeIds: UPPER,
    });
    expect(errors).toEqual([]);
    expect(instance.typeIds).toEqual([LOWER]);
  });

  it('still refuses a value that is not a UUID string', async () => {
    const { errors } = await parse(KickDto, { userId: 7 });
    expect(errors.map((error) => error.property)).toEqual(['userId']);
  });

  it('lowercases every UUID field of every DTO', () => {
    const fields = dtoClasses().flatMap((cls) =>
      uuidFields(cls).map((field) => ({
        ...field,
        cls,
        name: `${cls.name}.${field.property}`,
      })),
    );
    expect(fields.map(({ name }) => name)).toContain('KickDto.userId');
    const misses = fields.filter((field) => !lowercases(field.cls, field));
    expect(misses.map(({ name }) => name)).toEqual([]);
  });
});
