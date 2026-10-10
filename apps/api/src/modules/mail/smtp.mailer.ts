import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import {
  MAIL_ADDRESS_PATTERN,
  type MailMessage,
  type Mailer,
} from '@libs/common';
import { SettingsService } from '@libs/settings';

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

/** The transport is rebuilt (and the old one closed) whenever the `mail.smtpUrl` setting changed; `mail.from` is read per message. */
@Injectable()
export class SmtpMailer implements Mailer {
  private current: { url: string; transport: Transporter } | null = null;

  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {}

  /** Resolved transport options, for tests. */
  get transportOptions(): Record<string, unknown> {
    return (this.transport() as unknown as { options: Record<string, unknown> })
      .options;
  }

  isConfigured(): boolean {
    return Boolean(this.settings.get('mail.smtpUrl'));
  }

  async send(message: MailMessage): Promise<void> {
    if (!MAIL_ADDRESS_PATTERN.test(message.to))
      throw new Error('Invalid mail recipient');
    if (CONTROL_CHARACTER.test(message.subject))
      throw new Error('Invalid mail subject');
    await this.transport().sendMail({
      from: this.settings.get('mail.from'),
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }

  private transport(): Transporter {
    const url = this.settings.get('mail.smtpUrl');
    if (!url) throw new Error('Mail is not configured');
    if (this.current?.url !== url) {
      this.current?.transport.close();
      this.current = { url, transport: createTransport(withTimeouts(url)) };
    }
    return this.current.transport;
  }
}
