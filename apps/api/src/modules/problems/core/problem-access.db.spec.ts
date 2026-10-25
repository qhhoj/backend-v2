import { getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  DatabaseModule,
  newId,
  Problem,
  toUuid,
  uuidStr,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import type { Model } from 'mongoose';
import {
  ProblemAccess,
  ProblemAccessView,
  type ContestScope,
} from './problem-access';

import {
  ORG,
  OTHER,
  PRINCIPALS,
  USER,
  view,
} from '../../../../test/problem-access-fixtures';

describe('ProblemAccess.visibleFilter', () => {
  let replSet: TestMongo,
    testingModule: TestingModule,
    problems: Model<Problem>;
  const generated: Array<{ code: string; view: ProblemAccessView }> = [];
  const documents: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    problems = testingModule.get(getModelToken(Problem.name));
    const roles: Array<Partial<ProblemAccessView>> = [
      {},
      { authors: [USER] },
      { curators: [USER] },
      { testers: [USER] },
      { suggester: USER },
      { suggester: OTHER },
      { authors: [OTHER] },
      { authors: [OTHER], testers: [USER] },
      { curators: [OTHER], suggester: OTHER },
    ];
    let index = 0;
    for (const isPublic of [true, false])
      for (const isOrganizationPrivate of [true, false])
        for (const organizations of [[ORG], [newId()], []])
          for (const role of roles) {
            const problemView = view({
              isPublic,
              isOrganizationPrivate,
              organizations,
              ...role,
            });
            const code = `p${index++}`;
            generated.push({ code, view: problemView });
            documents.push({
              ...problemView,
              code,
              name: code,
              timeLimit: 1,
              memoryLimit: 1,
              points: 1000,
              typeIds: [newId()],
              groupId: newId(),
            });
          }
    await problems.insertMany(documents);
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  const NAMED = Object.entries(PRINCIPALS);

  it.each(NAMED)('matches canSee for %s', async (_who, principal) => {
    const expected = generated
      .filter(({ view: problemView }) =>
        ProblemAccess.canSee(principal, problemView, null),
      )
      .map(({ code }) => code)
      .sort();
    const actual = (
      await problems
        .find({
          $and: [
            { code: { $in: generated.map(({ code }) => code) } },
            ProblemAccess.visibleFilter(principal, null),
          ],
        })
        .lean()
    )
      .map((problem) => problem.code)
      .sort();
    expect(actual).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it.each(NAMED)('matches canEdit for %s', async (_who, principal) => {
    const expected = generated
      .filter(({ view: problemView }) =>
        ProblemAccess.canEdit(principal, problemView),
      )
      .map(({ code }) => code)
      .sort();
    const filter = ProblemAccess.editableFilter(principal);
    const actual = filter
      ? (
          await problems
            .find({
              $and: [
                { code: { $in: generated.map(({ code }) => code) } },
                filter,
              ],
            })
            .lean()
        )
          .map((problem) => problem.code)
          .sort()
      : [];
    expect(actual).toEqual(expected);
  });

  it('matches canSee under a contest scope, started or not', async () => {
    const codes = generated.map(({ code }) => code);
    const privateCodes = generated
      .filter(({ view: problemView }) => !problemView.isPublic)
      .map(({ code }) => code);
    const contestProblem = (await problems
      .findOne({ code: privateCodes[0] })
      .lean())!;
    const scopes: ContestScope[] = [
      {
        contestId: 'c-current',
        started: true,
        problemIds: [uuidStr(contestProblem._id)],
      },
      {
        contestId: 'c-current',
        started: false,
        problemIds: [uuidStr(contestProblem._id)],
      },
    ];
    for (const scope of scopes)
      for (const principal of Object.values(PRINCIPALS)) {
        const all = await problems.find({ code: { $in: codes } }).lean();
        const expected = all
          .filter((problem) =>
            ProblemAccess.canSee(
              principal,
              ProblemAccess.accessView(problem),
              scope,
            ),
          )
          .map((problem) => problem.code)
          .sort();
        const actual = (
          await problems
            .find({
              $and: [
                { code: { $in: codes } },
                ProblemAccess.visibleFilter(principal, scope),
              ],
            })
            .lean()
        )
          .map((problem) => problem.code)
          .sort();
        expect(actual).toEqual(expected);
      }
  });

  it('treats a raw document lacking suggester and arrays as having none', async () => {
    await problems.db
      .collection<{
        _id: ReturnType<typeof toUuid>;
        code: string;
        name: string;
        isPublic: boolean;
        isOrganizationPrivate: boolean;
      }>('problems')
      .insertOne({
        _id: toUuid(newId()),
        code: 'rawdoc',
        name: 'rawdoc',
        isPublic: false,
        isOrganizationPrivate: false,
      });
    try {
      const lean = (await problems.findOne({ code: 'rawdoc' }).lean())!;
      const problemView = ProblemAccess.accessView(lean);
      expect(problemView).toEqual({
        ...view({ isPublic: false }),
        id: uuidStr(lean._id),
      });
      for (const principal of Object.values(PRINCIPALS)) {
        const visible =
          (
            await problems
              .find({
                $and: [
                  { code: 'rawdoc' },
                  ProblemAccess.visibleFilter(principal, null),
                ],
              })
              .lean()
          ).length === 1;
        expect(visible).toBe(
          ProblemAccess.canSee(principal, problemView, null),
        );
      }
    } finally {
      await problems.deleteOne({ code: 'rawdoc' });
    }
  });
});
