import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type Env } from '../env/env';
import type { MailMessage, Mailer } from './mailer';

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = createTransport(env.smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    if (/[\r\n]/.test(message.to) || /[\r\n]/.test(message.subject))
      throw new Error('Mail recipient and subject must be single-line');
    await this.transport.sendMail({
      from: this.env.mailFrom,
      to: { name: '', address: message.to },
      subject: message.subject,
      text: message.text,
    });
  }
}
