import { ProblemMetaResponse } from '../src/modules/problems/dto/problem-meta.response';
import { Catalog, seedCatalog } from './problem-fixtures';
import { ApiTest, setupApiTest } from './setup';

const META = '/api/internal/problems/meta';
const metaOf = (response: { body: unknown }) =>
  (response.body as { data: ProblemMetaResponse }).data;

describe('GET /api/internal/problems/meta', () => {
  let api: ApiTest;
  let catalog: Catalog;
  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterAll(() => api.teardown());

  it('lists types, groups, licenses and languages for anonymous users, sorted by display name', async () => {
    const meta = metaOf(await api.http().get(META).expect(200));
    expect(meta.types.map((type) => type.fullName)).toEqual([
      'Dynamic Programming',
      'Uncategorized',
    ]);
    expect(meta.types[1]).toEqual({
      id: catalog.types.uncategorized,
      name: 'uncategorized',
      fullName: 'Uncategorized',
    });
    expect(meta.groups.map((group) => group.fullName)).toEqual([
      'Uncategorized',
      'VOI',
    ]);
    expect(meta.licenses).toEqual([
      {
        id: catalog.licenses.mit,
        key: 'mit',
        name: 'MIT License',
        link: 'https://opensource.org/licenses/MIT',
        display: '',
        icon: '',
      },
    ]);
    expect(meta.languages.map((language) => language.key)).toEqual([
      'CPP17',
      'PY3',
      'TEXT',
    ]);
    expect(meta.languages[0]).toEqual({
      id: catalog.languages.cpp,
      key: 'CPP17',
      name: 'C++17',
      shortName: null,
      commonName: 'C++',
      ace: 'c_cpp',
      extension: 'cpp',
      template: '',
      fileOnly: false,
      fileSizeLimit: 0,
      includeInProblem: true,
    });
  });
  it('reflects new catalog rows after a resync', async () => {
    await api.problemTypes.create({ name: 'graph', fullName: 'Graph Theory' });
    await api.resyncCatalog();
    expect(
      metaOf(await api.http().get(META).expect(200)).types.map(
        (type) => type.name,
      ),
    ).toEqual(['dp', 'graph', 'uncategorized']);
  });
});
