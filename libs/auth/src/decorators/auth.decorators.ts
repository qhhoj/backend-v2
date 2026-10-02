import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Permission } from '../principal/permissions';

export const PUBLIC_ROUTE = 'auth:public';
export const PARTIAL_AUTH_ROUTE = 'auth:partial';
export const PWNED_PASSWORD_ROUTE = 'auth:pwned';
export const SESSION_ONLY_ROUTE = 'auth:session-only';
export const NO_IMPERSONATION_ROUTE = 'auth:no-impersonation';
export const REQUIRED_PERMISSION = 'auth:permission';

/** No login required. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
/** Reachable before the second factor is verified (2FA endpoints, me, logout). */
export const AllowPartialAuth = () => SetMetadata(PARTIAL_AUTH_ROUTE, true);
/** Reachable while the password is flagged as breached (password change, me, logout). */
export const AllowPwnedPassword = () => SetMetadata(PWNED_PASSWORD_ROUTE, true);
/** Management endpoints: API tokens (Bearer) are refused, a browser session is required. */
export const SessionOnly = () => SetMetadata(SESSION_ONLY_ROUTE, true);
/** Refused (403 `forbidden`) while a superuser impersonates: account-security changes (password change, API token regeneration, 2FA enrolment/removal, WebAuthn credential routes, impersonation start/stop). */
export const NoImpersonation = () => SetMetadata(NO_IMPERSONATION_ROUTE, true);
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<FastifyRequest>().auth,
);
