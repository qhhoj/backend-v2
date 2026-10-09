import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { TicketCannedReplySchema } from './ticket-canned-reply.schema';
import { TicketSchema } from './ticket.schema';

describe('Ticket extras schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Tickets = mongoose.model('TicketExtrasSchemaSpec', TicketSchema);
  const Replies = mongoose.model(
    'TicketCannedReplySchemaSpec',
    TicketCannedReplySchema,
  );
  const ticketFields = () => ({
    title: 'Help',
    user: newId(),
    linkedItem: { type: 'general', id: newId() },
  });

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all([Tickets.syncIndexes(), Replies.syncIndexes()]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('starts a ticket with an empty timeline and not answered by staff', async () => {
    const ticket = await Tickets.create(ticketFields());
    expect(ticket.events).toHaveLength(0);
    expect(ticket.lastMessageByStaff).toBe(false);
  });

  it('stores a timeline event with an id, its actor and an optional target', async () => {
    const actor = newId();
    const target = newId();
    const ticket = await Tickets.create({
      ...ticketFields(),
      events: [
        { type: 'closed', user: actor, at: new Date() },
        { type: 'assigned', user: actor, at: new Date(), target },
      ],
    });
    const stored = await Tickets.findById(ticket._id).lean();
    expect(
      stored?.events.map((event) => [event.type, event.target ?? null]),
    ).toEqual([
      ['closed', null],
      ['assigned', expect.anything()],
    ]);
    expect(stored?.events[0]._id).toBeDefined();
  });

  it('refuses an unknown timeline event type', async () => {
    await expect(
      Tickets.create({
        ...ticketFields(),
        events: [{ type: 'exploded', user: newId(), at: new Date() }],
      }),
    ).rejects.toThrow(/type/);
  });

  it('keeps canned reply titles and bodies within their limits', async () => {
    const fields = { title: 'Đã nhận', body: 'Chào {tên}', createdBy: newId() };
    const reply = await Replies.create(fields);
    expect(reply.order).toBe(0);
    await expect(
      Replies.create({ ...fields, title: 'x'.repeat(61) }),
    ).rejects.toThrow(/title/);
    await expect(
      Replies.create({ ...fields, body: 'x'.repeat(8193) }),
    ).rejects.toThrow(/body/);
    await expect(Replies.create({ ...fields, title: '' })).rejects.toThrow(
      /title/,
    );
  });
});
