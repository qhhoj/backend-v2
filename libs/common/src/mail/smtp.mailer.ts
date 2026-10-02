import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type Env } from '../env/env';
import { MAIL_ADDRESS_PATTERN, type MailMessage, type Mailer } from './mailer';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1F\x7F]/;

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = createTransport(env.smtpUrl);
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
