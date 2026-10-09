import { bulkUpdate } from './bulk-update';

describe('bulkUpdate', () => {
  it('archives and unarchives, creating an untagged link when none exists', () => {
    expect(bulkUpdate('archive', undefined)).toEqual({
      $set: { archived: true },
      $setOnInsert: { tagIds: [] },
    });
    expect(bulkUpdate('unarchive', undefined)).toEqual({
      $set: { archived: false },
      $setOnInsert: { tagIds: [] },
    });
  });

  it('adds a tag once and removes it, creating an unarchived link when none exists', () => {
    expect(bulkUpdate('add-tag', 'tag-id')).toEqual({
      $addToSet: { tagIds: 'tag-id' },
      $setOnInsert: { archived: false },
    });
    expect(bulkUpdate('remove-tag', 'tag-id')).toEqual({
      $pull: { tagIds: 'tag-id' },
      $setOnInsert: { archived: false },
    });
  });
});
