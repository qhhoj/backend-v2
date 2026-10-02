import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { baseSchemaOptions, CI, ciIndex, IdProp } from './schema';
import { startMongo } from './testing';

@Schema({ ...baseSchemaOptions, collection: 'things' })
class Thing {
  @IdProp() _id!: string;
  @Prop({ required: true }) name!: string;
}
const ThingSchema = SchemaFactory.createForClass(Thing);
ciIndex(ThingSchema, 'name');

describe('schema base', () => {
  let replSet: MongoMemoryReplSet;
  const Things = mongoose.model('Thing', ThingSchema);
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Things.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('assigns UUID _id and exposes id in JSON', async () => {
    const thing = await Things.create({ name: 'Alpha' });
    expect(thing.toJSON()).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      name: 'Alpha',
    });
    expect(thing.toJSON()).not.toHaveProperty('_id');
  });
  it('enforces case-insensitive uniqueness and lookup', async () => {
    await expect(Things.create({ name: 'ALPHA' })).rejects.toThrow(
      /duplicate key/,
    );
    expect(
      await Things.findOne({ name: 'alpha' }).collation(CI),
    ).not.toBeNull();
  });
});
