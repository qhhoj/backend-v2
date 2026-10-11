import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { Contest, DatabaseModule, newId } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import type { Model } from 'mongoose';
import { ContestAccess } from './contest-access';
import type { ContestAccessView } from './contest-access';
import {
  ORG,
  OTHER,
  PRINCIPALS,
  USER,
  view,
} from '../../../../test/contest-access-fixtures';

describe('ContestAccess.visibleFilter and editableFilter', () => {
  let replSet: TestMongo;
  let testingModule: TestingModule;
  let contests: Model<Contest>;
  const generated: Array<{ key: string; view: ContestAccessView }> = [];
  const documents: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    replSet = await startMongo();
    process.env.MONGO_URL = replSet.getUri('qhhoj');
    testingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    contests = testingModule.get(getModelToken(Contest.name));
    const roles: Array<Partial<ContestAccessView>> = [
      {},
      { authors: [USER] },
      { curators: [USER] },
      { testers: [USER] },
      { privateContestants: [USER] },
      { privateContestants: [OTHER] },
      { viewContestScoreboard: [USER] },
      { balloonStaff: [USER] },
      { authors: [OTHER] },
    ];
    let index = 0;
    for (const isVisible of [true, false])
      for (const isPrivate of [true, false])
        for (const isOrganizationPrivate of [true, false])
          for (const organizations of [[ORG], [newId()]])
            for (const role of roles) {
              const contestView = view({
                isVisible,
                isPrivate,
                isOrganizationPrivate,
                organizations,
                ...role,
              });
              const key = `c${index++}`;
              generated.push({ key, view: contestView });
              documents.push({ ...contestView, key, name: key });
            }
    await contests.insertMany(documents);
  });
  afterAll(async () => {
    await testingModule.close();
    await replSet.stop();
  });

  it.each(Object.keys(PRINCIPALS))(
    'matches exactly what canSee allows for %s',
    async (who) => {
      const principal = PRINCIPALS[who];
      const expected = generated
        .filter(({ view: contestView }) =>
          ContestAccess.canSee(principal, contestView),
        )
        .map(({ key }) => key)
        .sort();
      const actual = (
        await contests
          .find({
            $and: [
              { key: { $in: generated.map(({ key }) => key) } },
              ContestAccess.visibleFilter(principal),
            ],
          })
          .lean()
      )
        .map((contest) => contest.key)
        .sort();
      expect(actual).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    },
  );

  it.each(Object.keys(PRINCIPALS))(
    'editableFilter matches exactly what canEdit allows for %s',
    async (who) => {
      const principal = PRINCIPALS[who];
      const expected = generated
        .filter(({ view: contestView }) =>
          ContestAccess.canEdit(principal, contestView),
        )
        .map(({ key }) => key)
        .sort();
      const filter = ContestAccess.editableFilter(principal);
      const actual = filter
        ? (
            await contests
              .find({
                $and: [
                  { key: { $in: generated.map(({ key }) => key) } },
                  filter,
                ],
              })
              .lean()
          )
            .map((contest) => contest.key)
            .sort()
        : [];
      expect(actual).toEqual(expected);
    },
  );
});
