import type { Language } from '@libs/database';
import type { JudgesRepository, PublicJudgeRow } from '../judges.repository';
import type { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { RuntimesService } from './runtimes.service';

const judge = (extra: Partial<PublicJudgeRow>): PublicJudgeRow => ({
  name: 'judge-a',
  online: true,
  slots: 4,
  busy: 2,
  ping: 0.0123,
  startTime: new Date('2026-10-01T00:00:00Z'),
  runtimes: [
    { language: 'CPP17', name: 'g++', version: '13.2.0', priority: 1 },
  ],
  ...extra,
});
const language = (key: string, name: string): Language =>
  ({
    key,
    name,
    commonName: name,
    extension: 'cpp',
    fileOnly: false,
  }) as Language;

function serviceWith(judges: PublicJudgeRow[]) {
  return new RuntimesService(
    {
      listPublic: () => Promise.resolve(judges),
    } as unknown as JudgesRepository,
    {
      all: () => [language('PY3', 'Python 3'), language('CPP17', 'C++17')],
    } as unknown as LanguagesQuerier,
  );
}

describe('RuntimesService', () => {
  it('reports ping in milliseconds and lists only the public fields', async () => {
    const { judges } = await serviceWith([judge({})]).overview();
    expect(judges).toEqual([
      {
        name: 'judge-a',
        online: true,
        slots: 4,
        busy: 2,
        pingMs: 12,
        startedAt: new Date('2026-10-01T00:00:00Z'),
      },
    ]);
  });

  it('shows an offline judge with no load, ping or uptime but keeps its versions', async () => {
    const offline = judge({ online: false, busy: 3, ping: 0.02 });
    const { judges, languages } = await serviceWith([offline]).overview();
    expect(judges[0]).toMatchObject({
      online: false,
      busy: 0,
      pingMs: null,
      startedAt: null,
    });
    expect(languages[0].versions).toEqual([
      { judge: 'judge-a', compiler: 'g++', version: '13.2.0' },
    ]);
  });

  it('sorts languages by name and gives a language no judge runs an empty version list', async () => {
    const { languages } = await serviceWith([judge({})]).overview();
    expect(languages.map((entry) => entry.key)).toEqual(['CPP17', 'PY3']);
    expect(languages[1].versions).toEqual([]);
  });
});
