import { AppError } from '../errors/app.error';
import { hasControlCharacter } from '../text/control-characters';

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

/** Throws for a message no transport may send: a recipient that is not one bare address, or a subject with a control character (it would inject a header). */
export function assertMailMessage({ to, subject }: MailMessage): void {
  if (!MAIL_ADDRESS_PATTERN.test(to)) throw new Error('Invalid mail recipient');
  if (hasControlCharacter(subject)) throw new Error('Invalid mail subject');
}
