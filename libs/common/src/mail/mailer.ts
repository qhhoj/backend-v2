import { AppError } from '../errors/app.error';

export interface MailMessage {
  /** a single bare email address */
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** False when no transport is set up; absent means always available. */
  isConfigured?(): boolean;
}

/** Throws 503 `mail_unavailable` when the mailer reports it is not configured. */
export function assertMailAvailable(mailer: Mailer): void {
  if (mailer.isConfigured?.() === false)
    throw new AppError('mail_unavailable', 503, 'Mail is not configured');
}

export const MAILER = Symbol('MAILER');

/** ASCII allow-list for a single bare address; no display names, groups, quoting or lists. */
export const MAIL_ADDRESS_PATTERN =
  /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
