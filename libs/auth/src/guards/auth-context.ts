import { Principal } from '../principal/principal';
import { SessionData } from '../session/session.service';
import { UserDocument } from '../users/users.repository';

export interface AuthContext {
  user: UserDocument;
  principal: Principal;
  sessionId: string | null;
  session: SessionData | null;
  viaToken: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
