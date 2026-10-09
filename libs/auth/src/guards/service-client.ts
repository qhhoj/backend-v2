import type { IntegrationScope } from '@libs/database';

/** An integration client acting through a `@ServiceOnly()` route. Not a `Principal`: it has no user, no session and no permissions of its own; `actsAs` names the user whose permissions bound what it may do. */
export interface ServiceClientPrincipal {
  clientId: string;
  name: string;
  scopes: readonly IntegrationScope[];
  actsAs: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    serviceClient?: ServiceClientPrincipal;
  }
}
