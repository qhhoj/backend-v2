import { Inject, Injectable } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { ENV, type Env } from '../env/env';
import { MailMessage, Mailer } from './mailer';

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = createTransport(env.smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.env.mailFrom, ...message });
  }
}
