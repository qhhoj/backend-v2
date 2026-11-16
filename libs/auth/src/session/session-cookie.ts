import '@fastify/cookie';
import { FastifyReply } from 'fastify';
import { SESSION_TTL_SECONDS } from './session.service';

/** `__Host-`: the browser takes it only Secure, Path=/ and without Domain, so a sibling subdomain cannot plant one. */
export const SESSION_COOKIE = '__Host-qhhoj_session';
/** The name before 2026-11-16: still read when no `__Host-` cookie came, then reissued; drop after 2026-12-16 (docs/decisions.md). */
export const LEGACY_SESSION_COOKIE = 'qhhoj_session';

/** `__Host-` needs Secure: with COOKIE_SECURE=false (local http) the cookie keeps the plain name. */
const sessionCookieName = (secure: boolean) =>
  secure ? SESSION_COOKIE : LEGACY_SESSION_COOKIE;

export interface SessionCookie {
  /** The session id the request carries; the `__Host-` cookie wins over the old name. */
  id: string | undefined;
  /** The id came under the old name only: valid only for a session never issued as `__Host-` (`hostCookie`), then reissued. */
  fromLegacy: boolean;
  /** An old-name cookie came along (secure mode): expire it. */
  legacySent: boolean;
}

export function readSessionCookie(
  cookies: Record<string, string | undefined>,
  secure: boolean,
): SessionCookie {
  const current = cookies[sessionCookieName(secure)];
  const legacy = secure ? cookies[LEGACY_SESSION_COOKIE] : undefined;
  return {
    id: current ?? legacy,
    fromLegacy: current === undefined && legacy !== undefined,
    legacySent: legacy !== undefined,
  };
}

export const setSessionCookie = (
  reply: FastifyReply,
  id: string,
  secure: boolean,
) =>
  reply.setCookie(sessionCookieName(secure), id, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

export interface CookieSite {
  cookieSecure: boolean;
  siteUrl: string;
}

/**
 * Expires the old name host-only and on the site's domain (where a sibling subdomain can plant it), at Path=/ and /api.
 * Another path or a parent domain cannot be reached from here; the guard refuses such a cookie for a `hostCookie` session anyway.
 */
export const clearLegacySessionCookie = (
  reply: FastifyReply,
  site: CookieSite,
) => {
  const domain = new URL(site.siteUrl).hostname;
  reply.clearCookie(LEGACY_SESSION_COOKIE, { path: '/', secure: true });
  for (const path of ['/', '/api'])
    reply.clearCookie(LEGACY_SESSION_COOKIE, { domain, path, secure: true });
};

/** A browser drops a `__Host-` Set-Cookie, a deleting one too, unless it is Secure with Path=/. */
export const clearSessionCookie = (reply: FastifyReply, site: CookieSite) => {
  const secure = site.cookieSecure;
  reply.clearCookie(sessionCookieName(secure), { path: '/', secure });
  if (secure) clearLegacySessionCookie(reply, site);
};
