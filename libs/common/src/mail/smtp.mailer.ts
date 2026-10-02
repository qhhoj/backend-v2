import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type Env } from '../env/env';
import { MAIL_ADDRESS_PATTERN, type MailMessage, type Mailer } from './mailer';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1F\x7F]/;

const DEFAULT_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
};

/** Adds the default timeouts as URL query params (nodemailer parses them into transport options) unless the URL sets them. */
function withTimeouts(smtpUrl: string): string {
  const url = new URL(smtpUrl);
  for (const [name, milliseconds] of Object.entries(DEFAULT_TIMEOUTS))
    if (!url.searchParams.has(name))
      url.searchParams.set(name, String(milliseconds));
  return url.toString();
}

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  /** Resolved transport options, for tests. */
  get transportOptions(): Record<string, unknown> {
    return (this.transport as unknown as { options: Record<string, unknown> })
      .options;
  }

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = createTransport(withTimeouts(env.smtpUrl));
  }

  async send(message: MailMessage): Promise<void> {
    if (!MAIL_ADDRESS_PATTERN.test(message.to))
      throw new Error('Invalid mail recipient');
    if (CONTROL_CHARACTER.test(message.subject))
      throw new Error('Invalid mail subject');
    await this.transport.sendMail({
      from: this.env.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
