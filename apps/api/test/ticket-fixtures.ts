import { newId } from '@libs/database';
import type { Ticket, User } from '@libs/database';
import { createUserWith, loginAs } from './problem-fixtures';
import type { ApiTest } from './setup';

let ticketCount = 0;

/** A ticket written straight to Mongo with one message by its creator: on `problem` (an id), or general (`issueUrl`, default a fresh issue). */
export async function createTicket(
  api: ApiTest,
  {
    creator,
    assignees = [],
    problem,
    issueUrl = 'https://example.com/issue',
    ...overrides
  }: {
    creator: string;
    assignees?: string[];
    problem?: string;
    issueUrl?: string;
  } & Partial<Ticket>,
) {
  const linkedItem = problem
    ? { type: 'problem' as const, id: problem }
    : {
        type: 'general' as const,
        id: (await api.generalIssues.create({ issueUrl }))._id,
      };
  return api.tickets.create({
    title: `Ticket ${(ticketCount += 1)}`,
    user: creator,
    assignees,
    linkedItem,
    messages: [
      {
        _id: newId(),
        user: creator,
        body: 'help',
        bodyHtml: '<p>help</p>',
        createdAt: new Date(),
      },
    ],
    messageCount: 1,
    lastMessageAt: new Date(),
    ...overrides,
  });
}

export const ticketUrl = (id: string, suffix = '') =>
  `/api/internal/tickets/${id}${suffix}`;

export async function signedIn(
  api: ApiTest,
  username: string,
  extra: Partial<User> = {},
) {
  const user = await createUserWith(api, username, extra);
  return { user, session: await loginAs(api, user._id) };
}
