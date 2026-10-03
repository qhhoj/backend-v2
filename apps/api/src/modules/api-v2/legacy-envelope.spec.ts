import { legacyEnvelope, legacyError, legacyPage } from './legacy-envelope';

describe('legacy envelope', () => {
  it('wraps data with the api_version header', () =>
    expect(legacyEnvelope('GET', { ok: true })).toEqual({
      api_version: '2.0',
      method: 'get',
      fetched: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      data: { ok: true },
    }));
  it('formats errors like Django', () =>
    expect(legacyError('get', 404, 'page/object not found')).toMatchObject({
      api_version: '2.0',
      method: 'get',
      error: { code: 404, message: 'page/object not found' },
    }));
  it('paginates 1000 per page with a minimum of one page', () => {
    expect(legacyPage([], 1, 0)).toEqual({
      current_object_count: 0,
      objects_per_page: 1000,
      page_index: 1,
      has_more: false,
      objects: [],
      total_objects: 0,
      total_pages: 1,
    });
    expect(legacyPage(['x'], 2, 1001)).toMatchObject({
      current_object_count: 1,
      page_index: 2,
      has_more: false,
      total_objects: 1001,
      total_pages: 2,
    });
    expect(legacyPage(['x'], 1, 1001).has_more).toBe(true);
  });
});
