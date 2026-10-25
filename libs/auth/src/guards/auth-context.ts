import { Principal } from '../principal/principal';
import { SessionData } from '../session/session.service';
import { UserDocument } from '../users/users.repository';

export interface AuthContext {
  user: UserDocument;
  principal: Principal;
  sessionId: string | null;
  session: SessionData | null;
  viaToken: boolean;
  /** The client IP (`request.ip`, which honours `TRUST_PROXY`); password checks queue under it. */
  ip: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
