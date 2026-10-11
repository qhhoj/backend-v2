import mongoose from 'mongoose';
import { profileQueries, startMongo } from '../testing';
import type { TestMongo } from '../testing';
import { newId } from '../uuid';
import { SettingRevisionSchema } from './setting-revision.schema';

describe('Settings schemas', () => {
  let replSet: TestMongo;
  const Revisions = mongoose.model(
    'SettingRevisionSchemaSpec',
    SettingRevisionSchema,
  );

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Revisions.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('reads one setting history newest first from its index, page by page', async () => {
    await Revisions.insertMany(
      Array.from({ length: 50 }, (_item, index) => ({
        _id: newId(),
        key: index % 2 ? 'pdf.maxBytes' : 'contest.officialMode',
        before: index,
        after: index + 1,
        changedFields: ['value'],
        actor: null,
      })),
    );
    const operations = await profileQueries(mongoose.connection.db!, () =>
      Revisions.find({ key: 'pdf.maxBytes' })
        .sort({ _id: -1 })
        .limit(10)
        .lean(),
    );
    const read = operations.find(
      (operation) => operation.collection === 'settingRevisions',
    );
    // Only the requested page is read: the key index serves the filter and the sort together.
    expect(read?.planSummary).toBe('IXSCAN { key: 1, _id: -1 }');
    expect(read?.hasSortStage).toBe(false);
    expect(read?.docsExamined).toBe(10);
  });
});
