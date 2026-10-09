import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ContestGhostSchema } from './contest-ghost.schema';
import { ContestReplayChunkSchema } from './contest-replay-chunk.schema';
import { ContestReplayHeadSchema } from './contest-replay-head.schema';

describe('contest replay schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Chunks = mongoose.model(
    'ReplayChunkSchemaSpec',
    ContestReplayChunkSchema,
  );
  const Heads = mongoose.model('ReplayHeadSchemaSpec', ContestReplayHeadSchema);
  const Ghosts = mongoose.model('ContestGhostSchemaSpec', ContestGhostSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Chunks, Heads, Ghosts].map((model) => model.syncIndexes()),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps one chunk per contest, build, stream and index, with its tuples untouched', async () => {
    const [contest, buildId] = [newId(), newId()];
    const events = [
      [12, 0, 1, { points: 100, time: null }, 100, 12, 12],
      [30, 1, 0, {}, 0, 0, 0],
    ];
    await Chunks.create({ contest, buildId, chunk: 0, events });
    const stored = await Chunks.findOne({ contest, buildId, chunk: 0 }).lean();
    expect(stored!.events).toEqual(events);
    expect(stored!.stream).toBe('real');
    await expect(
      Chunks.create({ contest, buildId, chunk: 0, events: [] }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Chunks.create({
        contest,
        buildId,
        stream: 'ghost',
        chunk: 0,
        events: [],
      }),
    ).resolves.toBeDefined();
    await expect(
      Chunks.create({ contest, buildId: newId(), chunk: 0, events: [] }),
    ).resolves.toBeDefined();
  });

  it('stores one head per contest id', async () => {
    const contest = newId();
    const fields = {
      _id: contest,
      buildId: newId(),
      builtAt: new Date(),
      formatVersion: 1,
      chunkCount: 2,
      ghostChunkCount: 1,
      participants: [{ participationId: newId(), userId: newId() }],
      problems: [{ problemId: newId(), points: 100 }],
      ghosts: [{ label: 'Ann', caption: '', isUnranked: true, gap: 'points' }],
    };
    await Heads.create(fields);
    const stored = await Heads.findById(contest).lean();
    expect(stored!.participants).toHaveLength(1);
    expect(stored!.problems[0].points).toBe(100);
    expect(stored!.ghosts[0]).toMatchObject({
      label: 'Ann',
      isUnranked: true,
      gap: 'points',
    });
    await expect(Heads.create(fields)).rejects.toThrow(/duplicate key/);
  });

  it('keeps one ghost label per contest, defaults absent cell data to null and bounds the label', async () => {
    const contest = newId();
    const cell = { problemId: newId(), minute: 12 };
    const ghost = await Ghosts.create({
      contest,
      label: 'Ann',
      caption: '',
      cells: [cell],
    });
    expect(ghost.cells[0].rejectedBefore).toBeNull();
    expect(ghost.cells[0].points).toBeNull();
    await expect(
      Ghosts.create({ contest, label: 'Ann', caption: '', cells: [] }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Ghosts.create({ contest: newId(), label: 'Ann', caption: '', cells: [] }),
    ).resolves.toBeDefined();
    await expect(
      Ghosts.create({ contest, label: 'x'.repeat(65), caption: '', cells: [] }),
    ).rejects.toThrow(/label/);
    const tooManyTries = { problemId: newId(), minute: 5, rejectedBefore: 100 };
    await expect(
      Ghosts.create({
        contest: newId(),
        label: 'Bob',
        caption: '',
        cells: [tooManyTries],
      }),
    ).rejects.toThrow(/rejectedBefore/);
  });
});
