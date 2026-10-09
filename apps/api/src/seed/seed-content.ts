import { Contest, ContestSchema } from '@libs/database';
import type { Connection } from 'mongoose';
import { ensure } from './seed-ensure';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Test files of `e2e_max`: case i is `<i>.in` / `<i>.out`. */
export const MAX_FILES = {
  '1.in': '3 9\n',
  '1.out': '9\n',
  '2.in': '-5 -7\n',
  '2.out': '-5\n',
};

export interface ContestSpec {
  key: string;
  name: string;
  /** Days from `now`; negative is the past. */
  startOffsetDays: number;
  endOffsetDays: number;
  formatName: 'icpc' | 'default';
  problemIds: string[];
}

/** Creates each contest when its key is absent; returns the keys. */
export async function seedContests(
  connection: Connection,
  {
    authorId,
    specs,
    now = Date.now(),
  }: { authorId: string; specs: ContestSpec[]; now?: number },
): Promise<string[]> {
  const contests = connection.model<Contest>(Contest.name, ContestSchema);
  for (const spec of specs)
    await ensure(contests, { key: spec.key }, {
      key: spec.key,
      name: spec.name,
      summary: `${spec.name} for the full-stack smoke test`,
      description: `${spec.name}: solve the problems.`,
      descriptionHtml: `<p>${spec.name}: solve the problems.</p>`,
      authors: [authorId],
      startTime: new Date(now + spec.startOffsetDays * DAY_MS),
      endTime: new Date(now + spec.endOffsetDays * DAY_MS),
      isVisible: true,
      formatName: spec.formatName,
      problems: spec.problemIds.map((problem, order) => ({
        problem,
        points: 100,
        partial: true,
        order,
      })),
    } as Partial<Contest>);
  return specs.map((spec) => spec.key);
}
