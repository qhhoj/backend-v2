import { sha256 } from '@libs/auth';
import { Judge, JudgeSchema } from '@libs/database';
import type { Connection } from 'mongoose';

/** The judge the fake-judge CLI connects as; the key is stored only as its hash. */
export async function seedJudge(
  connection: Connection,
  { judgeName, judgeKey }: { judgeName: string; judgeKey: string },
): Promise<void> {
  const judges = connection.model<Judge>(Judge.name, JudgeSchema);
  if (await judges.exists({ name: judgeName })) return;
  await judges.create({ name: judgeName, authKeyHash: sha256(judgeKey) });
}
