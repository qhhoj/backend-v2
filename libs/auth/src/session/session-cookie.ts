import '@fastify/cookie';
import { FastifyReply } from 'fastify';
import { SESSION_TTL_SECONDS } from './session.service';

export const SESSION_COOKIE = 'qhhoj_session';

export const setSessionCookie = (
  reply: FastifyReply,
  id: string,
  secure: boolean,
) =>
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

export const clearSessionCookie = (reply: FastifyReply) =>
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
