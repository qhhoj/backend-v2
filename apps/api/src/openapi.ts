import type { INestApplication } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ErrorResponse, envelopeResponses, errorResponses } from '@libs/common';
import { untypeAnyJson } from './modules/settings/dto/any-json-value';

/** The sections of the API reference, in sidebar order; every controller is tagged with exactly one of these names (`@ApiTags`). */
export const API_SECTIONS: ReadonlyArray<
  readonly [name: string, description: string]
> = [
  [
    'Auth',
    'Sign in and out, register, activate accounts, reset passwords, social sign-in, two-factor authentication and impersonation.',
  ],
  ['Account', "The signed-in user's own profile and personal data export."],
  [
    'Users',
    'Public user pages, rating history, activity heatmaps and the leaderboards.',
  ],
  [
    'Problems',
    "Browse the problem archive, read statements and data, and see a problem's languages, groups and types.",
  ],
  [
    'Problem editing',
    'Create and edit problems, their statements, test data, packages and revisions.',
  ],
  [
    'Submissions',
    'Submit solutions and read submissions, their results and source code.',
  ],
  ['Judging', 'Judge queue and rejudging operations.'],
  [
    'Contests',
    'Browse contests, join them, read rankings, announcements and take part.',
  ],
  [
    'Contest editing',
    'Create and manage contests, their problems, participants and settings.',
  ],
  ['Organizations', 'Organizations, their members, requests and pages.'],
  ['Blog', 'Blog posts and their lifecycle.'],
  [
    'Comments',
    'Comments on problems, contests and posts, with votes and moderation.',
  ],
  ['Tickets', 'Problem tickets, messages and canned replies.'],
  ['Notifications', "The signed-in user's notification inbox."],
  [
    'Live events',
    'Server-sent event streams that push updates to the browser.',
  ],
  [
    'Home & site',
    'The home page, site shell data, static pages and RSS and Atom feeds.',
  ],
  ['Search & tags', 'Site search and tags.'],
  [
    'Sync API (integrations)',
    'Integration keys and the key-authenticated API external systems use to sync contests.',
  ],
  [
    'Admin: users',
    'Staff tools to find, ban and recover users and to read user activity.',
  ],
  [
    'Admin: site & settings',
    'Staff tools for site settings, public config and static pages.',
  ],
  [
    'Admin: judges & languages',
    'Staff tools for judge servers, programming languages and judging infrastructure.',
  ],
  [
    'Short links',
    'Create, manage and follow short `/s/<code>` links to site pages.',
  ],
];

/** The contract of the internal API: what `GET /api/internal/openapi.json` serves and `npm run openapi:emit` writes. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('QHHOJ internal API')
    .setVersion('1')
    .addCookieAuth('qhhoj_session')
    .addBearerAuth();
  for (const [name, description] of API_SECTIONS)
    builder.addTag(name, description);
  const generated = SwaggerModule.createDocument(app, builder.build(), {
    extraModels: [ErrorResponse],
  });
  untypeAnyJson(generated);
  return errorResponses(envelopeResponses(generated));
}

export const OPENAPI_PATH = '/api/internal/openapi.json';

export function setupOpenApi(app: NestFastifyApplication): void {
  const document = buildOpenApiDocument(app);
  app
    .getHttpAdapter()
    .getInstance()
    .get(OPENAPI_PATH, (_request, reply) => reply.send(document));
}
