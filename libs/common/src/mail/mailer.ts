export interface MailMessage {
  /** a single bare email address */
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** ASCII allow-list for a single bare address; no display names, groups, quoting or lists. */
export const MAIL_ADDRESS_PATTERN =
  /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
